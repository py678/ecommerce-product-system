import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { hasAllScope, type Actor } from '../auth/permissions.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  GlobalStockMovementQueryDto,
  StockMovementQueryDto,
} from './dto/stock-movement.dto.js';

const publicFields = {
  id: true,
  productId: true,
  productName: true,
  type: true,
  beforeStock: true,
  quantityChange: true,
  afterStock: true,
  stockVersion: true,
  actorId: true,
  actorName: true,
  orderId: true,
  orderNo: true,
  reason: true,
  createdAt: true,
} as const;
@Injectable()
export class StockMovementsService {
  constructor(private readonly db: DatabaseService) {}
  async findAll(
    actor: Actor,
    q: GlobalStockMovementQueryDto,
    resource?: { productId?: string; orderId?: string },
  ) {
    if (
      q.createdFrom &&
      q.createdTo &&
      new Date(q.createdFrom) > new Date(q.createdTo)
    )
      throw new BadRequestException('开始时间不能晚于结束时间');
    return this.db.$transaction(
      async (tx) => {
        const stockScope = hasAllScope(actor, 'stock:read')
          ? {}
          : { ownerId: actor.id };
        if (resource?.productId) {
          const product = await tx.product.findFirst({
            where: {
              id: resource.productId,
              ...(hasAllScope(actor, 'stock:read') ? {} : { userId: actor.id }),
            },
            select: { id: true },
          });
          if (!product) throw new NotFoundException('商品不存在');
        }
        if (resource?.orderId) {
          const order = await tx.order.findFirst({
            where: {
              id: resource.orderId,
              ...(hasAllScope(actor, 'order:read')
                ? {}
                : { creatorId: actor.id }),
            },
            select: { id: true },
          });
          if (!order) throw new NotFoundException('订单不存在');
        }
        const where: Prisma.StockMovementWhereInput = {
          ...stockScope,
          productId: resource?.productId ?? q.productId,
          orderId: resource?.orderId,
          type: q.type,
          ...(q.name
            ? { productName: { contains: q.name, mode: 'insensitive' } }
            : {}),
          ...(q.orderNo
            ? { orderNo: { contains: q.orderNo, mode: 'insensitive' } }
            : {}),
          createdAt: {
            gte: q.createdFrom ? new Date(q.createdFrom) : undefined,
            lte: q.createdTo ? new Date(q.createdTo) : undefined,
          },
        };
        const rows = await tx.stockMovement.findMany({
          where,
          select: publicFields,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const total = await tx.stockMovement.count({ where });
        const orderIds = rows.flatMap((r) => (r.orderId ? [r.orderId] : []));
        const visible =
          actor.permissions?.includes('order:read') && orderIds.length
            ? await tx.order.findMany({
                where: {
                  id: { in: orderIds },
                  ...(hasAllScope(actor, 'order:read')
                    ? {}
                    : { creatorId: actor.id }),
                },
                select: { id: true, creatorId: true },
              })
            : [];
        const visibleIds = new Set(visible.map((o) => o.id));
        return {
          list: rows.map((r) => ({
            ...r,
            canViewOrder: r.orderId !== null && visibleIds.has(r.orderId),
          })),
          total,
          page: q.page,
          pageSize: q.pageSize,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  findProduct(id: string, actor: Actor, q: StockMovementQueryDto) {
    return this.findAll(actor, q, { productId: id });
  }
  findOrder(id: string, actor: Actor, q: StockMovementQueryDto) {
    return this.findAll(actor, q, { orderId: id });
  }
}
