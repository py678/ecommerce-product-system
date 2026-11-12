import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  hasAllScope,
  productScope,
  type Actor,
  type Permission,
} from '../auth/permissions.js';
import { CommerceAuthorityService } from '../commerce/commerce.module.js';
import { writeStockMovement } from '../stock-movements/stock-movement.writer.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma, OrderStatus } from '../generated/prisma/client.js';
import {
  RealtimeService,
  notifyResourceChange,
} from '../realtime/realtime.service.js';
import {
  CreateOrderDto,
  OrderQueryDto,
  ShipOrderDto,
} from './dto/order.dto.js';

const relations = {
  items: { orderBy: { id: 'asc' as const } },
  logs: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.OrderInclude;
type RecordWithItems = Prisma.OrderGetPayload<{ include: typeof relations }>;
const scope = (actor: Actor, permission: Permission = 'order:read') =>
  hasAllScope(actor, permission) ? {} : { creatorId: actor.id };
function summary(o: Prisma.OrderGetPayload<object>) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    creatorId: o.creatorId,
    customerName: o.customerName,
    status: o.status,
    totalAmount: o.totalAmount.toFixed(2),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}
function response(o: RecordWithItems) {
  return {
    ...summary(o),
    phone: o.phone,
    address: o.address,
    remark: o.remark,
    carrier: o.carrier,
    trackingNo: o.trackingNo,
    confirmedAt: o.confirmedAt,
    shippedAt: o.shippedAt,
    completedAt: o.completedAt,
    cancelledAt: o.cancelledAt,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      coverImage: i.coverImage,
      unitPrice: i.unitPrice.toFixed(2),
      quantity: i.quantity,
      subtotal: i.subtotal.toFixed(2),
    })),
    logs: o.logs.map((log) => ({
      id: log.id,
      actorId: log.actorId,
      actorName: log.actorName,
      action: log.action,
      fromStatus: log.fromStatus,
      toStatus: log.toStatus,
      reason: log.reason,
      createdAt: log.createdAt,
    })),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly authority: CommerceAuthorityService,
    private readonly realtime: RealtimeService,
  ) {}
  async findAll(actor: Actor, q: OrderQueryDto) {
    if (
      q.createdFrom &&
      q.createdTo &&
      new Date(q.createdFrom) > new Date(q.createdTo)
    )
      throw new BadRequestException('开始时间不能晚于结束时间');
    const where: Prisma.OrderWhereInput = {
      ...scope(actor),
      status: q.status,
      ...(q.search
        ? {
            OR: [
              { orderNo: { contains: q.search, mode: 'insensitive' } },
              { customerName: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      createdAt: {
        gte: q.createdFrom ? new Date(q.createdFrom) : undefined,
        lte: q.createdTo ? new Date(q.createdTo) : undefined,
      },
    };
    const [rows, total] = await this.db.$transaction(
      [
        this.db.order.findMany({
          where,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.db.order.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      list: rows.map(summary),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async findOne(id: string, actor: Actor) {
    const o = await this.db.order.findFirst({
      where: { id, ...scope(actor) },
      include: relations,
    });
    if (!o) throw new NotFoundException('订单不存在');
    return response(o);
  }
  async create(actor: Actor, dto: CreateOrderDto) {
    await this.authority.requireWriter();
    const key = dto.idempotencyKey.toLowerCase();
    const items = dto.items
      .map((i) => ({
        productId: i.productId.toLowerCase(),
        quantity: i.quantity,
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId));
    if (new Set(items.map((i) => i.productId)).size !== items.length)
      throw new BadRequestException('同一商品不能重复');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          customerName: dto.customerName,
          phone: dto.phone,
          address: dto.address,
          remark: dto.remark ?? '',
          items,
        }),
      )
      .digest('hex');
    const result = await this.db.$transaction(
      async (tx) => {
        // Serialize equal keys; unrelated orders only contend on shared product rows.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.id + ':' + key},0))`;
        const existing = await tx.order.findUnique({
          where: {
            creatorId_idempotencyKey: {
              creatorId: actor.id,
              idempotencyKey: key,
            },
          },
          include: relations,
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new ConflictException('幂等键已用于其他订单内容');
          return { order: existing, created: false };
        }
        await this.lockProducts(
          tx,
          items.map((i) => i.productId),
        );
        const products = await tx.product.findMany({
          where: {
            id: { in: items.map((i) => i.productId) },
            ...productScope(actor, 'product:read'),
          },
        });
        const snapshots = items.map((i) => {
          const p = products.find((p) => p.id === i.productId);
          if (!p) throw new ConflictException('商品已不可用，请重新选择');
          if (p.stock < i.quantity) throw new ConflictException('商品库存不足');
          return {
            productId: p.id,
            productName: p.name,
            coverImage: p.coverImage,
            unitPrice: p.price,
            quantity: i.quantity,
            subtotal: p.price.mul(i.quantity),
          };
        });
        for (const i of items) {
          const changed = await tx.product.updateMany({
            where: { id: i.productId, stock: { gte: i.quantity } },
            data: { stock: { decrement: i.quantity } },
          });
          if (changed.count !== 1) throw new ConflictException('商品库存不足');
        }
        const user = await tx.user.findUniqueOrThrow({
          where: { id: actor.id },
          select: { username: true },
        });
        const order = await tx.order.create({
          data: {
            orderNo: 'ORD' + randomUUID().replaceAll('-', ''),
            creatorId: actor.id,
            idempotencyKey: key,
            requestHash,
            customerName: dto.customerName,
            phone: dto.phone,
            address: dto.address,
            remark: dto.remark ?? '',
            totalAmount: snapshots.reduce(
              (sum, i) => sum.add(i.subtotal),
              new Prisma.Decimal(0),
            ),
            items: { create: snapshots },
            logs: {
              create: {
                actorId: actor.id,
                actorName: user.username,
                action: 'create',
                toStatus: 'PENDING',
              },
            },
          },
          include: relations,
        });
        for (const i of items) {
          const before = products.find((p) => p.id === i.productId)!;
          const product = await tx.product.findUniqueOrThrow({
            where: { id: i.productId },
          });
          await writeStockMovement(tx, {
            product,
            beforeStock: before.stock,
            type: 'ORDER_DEDUCT',
            actorId: actor.id,
            actorName: user.username,
            orderId: order.id,
            orderNo: order.orderNo,
            reason: '创建订单扣减库存',
          });
        }
        return { order, created: true };
      },
      { timeout: 15000 },
    );
    if (result.created)
      await this.notify(
        result.order,
        items.map((i) => i.productId),
        'created',
      );
    return response(result.order);
  }
  async transition(
    id: string,
    actor: Actor,
    action: 'confirm' | 'ship' | 'complete' | 'cancel',
    input: Partial<ShipOrderDto> & { reason?: string } = {},
  ) {
    await this.authority.requireWriter();
    const result = await this.db.$transaction(
      async (tx) => {
        // Scope the locking read AND final update, including resource ownership.
        const owner = hasAllScope(actor, ('order:' + action) as Permission)
          ? Prisma.empty
          : Prisma.sql` AND creator_id=${actor.id}::uuid`;
        const locked = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM orders WHERE id=${id}::uuid ${owner} FOR UPDATE`,
        );
        if (!locked.length) throw new NotFoundException('订单不存在');
        const order = await tx.order.findFirstOrThrow({
          where: { id, ...scope(actor, ('order:' + action) as Permission) },
          include: relations,
        });
        const allowed: Record<typeof action, OrderStatus[]> = {
          confirm: ['PENDING'],
          ship: ['CONFIRMED'],
          complete: ['SHIPPED'],
          cancel: ['PENDING', 'CONFIRMED'],
        };
        if (!allowed[action].includes(order.status))
          throw new ConflictException('当前订单状态不允许此操作');
        const next: Record<typeof action, OrderStatus> = {
          confirm: 'CONFIRMED',
          ship: 'SHIPPED',
          complete: 'COMPLETED',
          cancel: 'CANCELLED',
        };
        const cancelBefore: { id: string; stock: number }[] = [];
        if (action === 'cancel') {
          await this.lockProducts(
            tx,
            order.items.map((i) => i.productId),
          );
          for (const i of [...order.items].sort((a, b) =>
            a.productId.localeCompare(b.productId),
          )) {
            const before = await tx.product.findUniqueOrThrow({
              where: { id: i.productId },
              select: { id: true, stock: true },
            });
            cancelBefore.push(before);
            const changed = await tx.product.updateMany({
              where: {
                id: i.productId,
                stock: { lte: 2147483647 - i.quantity },
              },
              data: { stock: { increment: i.quantity } },
            });
            if (changed.count !== 1)
              throw new ConflictException('库存回补超出范围，请联系管理员');
          }
        }
        const now = new Date();
        const user = await tx.user.findUniqueOrThrow({
          where: { id: actor.id },
          select: { username: true },
        });
        const updated = await tx.order.update({
          where: {
            ...scope(actor, ('order:' + action) as Permission),
            id,
            status: order.status,
          },
          data: {
            status: next[action],
            ...(action === 'confirm'
              ? { confirmedAt: now }
              : action === 'ship'
                ? {
                    shippedAt: now,
                    carrier: input.carrier,
                    trackingNo: input.trackingNo,
                  }
                : action === 'complete'
                  ? { completedAt: now }
                  : { cancelledAt: now }),
            logs: {
              create: {
                actorId: actor.id,
                actorName: user.username,
                action,
                fromStatus: order.status,
                toStatus: next[action],
                reason: input.reason ?? '',
              },
            },
          },
          include: relations,
        });
        for (const before of cancelBefore) {
          const product = await tx.product.findUniqueOrThrow({
            where: { id: before.id },
          });
          await writeStockMovement(tx, {
            product,
            beforeStock: before.stock,
            type: 'ORDER_CANCEL',
            actorId: actor.id,
            actorName: user.username,
            orderId: order.id,
            orderNo: order.orderNo,
            // The product owner may read this ledger without access to the order's private notes.
            reason: '取消订单回补库存',
          });
        }
        return updated;
      },
      { timeout: 15000 },
    );
    await this.notify(
      result,
      action === 'cancel' ? result.items.map((i) => i.productId) : [],
      'updated',
    );
    return response(result);
  }
  private async lockProducts(tx: Prisma.TransactionClient, ids: string[]) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`,
    );
  }
  private async notify(
    order: RecordWithItems,
    ids: string[],
    operation: 'created' | 'updated',
  ) {
    try {
      const products = ids.length
        ? await this.db.product.findMany({
            where: { id: { in: ids } },
            select: { id: true, userId: true },
          })
        : [];
      for (const p of products)
        notifyResourceChange(
          this.realtime,
          'product',
          p.id,
          'updated',
          p.userId,
        );
    } catch {
      /* Notifications must not change a committed order result. */
    }
    // A transport failure must never turn a committed order into an HTTP failure.
    try {
      this.realtime.orderChanged(order.id, order.creatorId, operation);
    } catch {
      /* Client can fetch committed data again. */
    }
  }
}
