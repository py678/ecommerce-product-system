import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { CommerceAuthorityService } from '../commerce/commerce.module.js';
import { Prisma } from '../generated/prisma/client.js';
import { PUBLIC_USER_SELECT } from '../auth/public-user.js';
import type { Actor, Permission } from '../auth/permissions.js';
import { assertCanGrant, lockRoleAuthority } from '../roles/roles.service.js';
import {
  notifySessionChange,
  RealtimeService,
} from '../realtime/realtime.service.js';
import type {
  AccountReasonDto,
  PurgeAccountDto,
} from './dto/admin-user.dto.js';

@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
  ) {}

  private async target(
    tx: Prisma.TransactionClient,
    actor: Actor,
    id: string,
    permission: Permission,
  ) {
    const current = await lockRoleAuthority(tx, actor, permission);
    if (id === actor.id)
      throw new BadRequestException('不能删除或恢复当前账号');
    // Same lock as role assignment; row lock also serializes profile/password writes and FK inserts.
    await tx.$queryRaw`SELECT id FROM users WHERE id=${id}::uuid FOR UPDATE`;
    const target = await tx.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!target) throw new NotFoundException('账号不存在');
    if (permission === 'user:purge') {
      if (
        current.role !== 'ADMIN' ||
        current.roleId !== '00000000-0000-4000-8000-000000000010'
      )
        throw new ForbiddenException('仅系统管理员可彻底删除账号');
    } else {
      assertCanGrant(
        current,
        target.roleDefinition.grants.map((g) => ({
          permission: g.permissionCode as Permission,
          scope: g.scope,
        })),
        target.roleDefinition.code === 'ADMIN',
      );
    }
    return target;
  }
  async dependencies(actor: Actor, id: string) {
    await new CommerceAuthorityService(this.db).requireWriter();
    return this.db.$transaction(async (tx) => {
      const target = await this.target(tx, actor, id, 'user:purge');
      const productCount = await tx.product.count({ where: { userId: id } });
      const orderCount = await tx.order.count({ where: { creatorId: id } });
      return {
        productCount,
        orderCount,
        canPurge: !!target.deletedAt && productCount === 0 && orderCount === 0,
      };
    });
  }
  async change(
    actor: Actor,
    id: string,
    action: 'DELETE' | 'RESTORE' | 'PURGE',
    dto: AccountReasonDto | PurgeAccountDto,
  ) {
    await new CommerceAuthorityService(this.db).requireWriter();
    const permission = {
      DELETE: 'user:delete',
      RESTORE: 'user:restore',
      PURGE: 'user:purge',
    }[action] as Permission;
    try {
      await this.db.$transaction(async (tx) => {
        const target = await this.target(tx, actor, id, permission);
        if (action === 'DELETE' && target.deletedAt)
          throw new ConflictException('账号已经在回收站');
        if (action !== 'DELETE' && !target.deletedAt)
          throw new ConflictException('请先软删除账号');
        if (
          action === 'DELETE' &&
          target.roleDefinition.code === 'ADMIN' &&
          (await tx.user.count({
            where: {
              deletedAt: null,
              roleDefinition: { code: 'ADMIN', enabled: true },
            },
          })) <= 1
        )
          throw new ConflictException('不能删除最后一个有效管理员');
        if (action === 'PURGE') {
          if ((dto as PurgeAccountDto).username !== target.username)
            throw new BadRequestException('确认用户名不匹配');
          if (
            (await tx.product.count({ where: { userId: id } })) ||
            (await tx.order.count({ where: { creatorId: id } }))
          )
            throw new ConflictException('账号仍有商品或订单，不能彻底删除');
          // Capture tombstone before DELETE in the same source transaction.
          await tx.userTombstone.create({ data: { id } });
          await tx.user.delete({ where: { id, deletedAt: { not: null } } });
        } else {
          await tx.user.update({
            where: {
              id,
              deletedAt: action === 'DELETE' ? null : { not: null },
            },
            data: {
              deletedAt: action === 'DELETE' ? new Date() : null,
              deletedBy: action === 'DELETE' ? actor.id : null,
              deleteReason: action === 'DELETE' ? dto.reason : null,
              tokenVersion: { increment: 1 },
            },
          });
        }
        await tx.accountAudit.create({
          data: {
            actorId: actor.id,
            targetId: id,
            username: target.username,
            action,
            reason: dto.reason,
          },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2003', 'P2025'].includes(e.code)
      )
        throw new ConflictException('账号状态或关联数据已变化，请刷新后重试');
      throw e;
    }
    notifySessionChange(this.realtime, id, 'securityChanged');
    return {
      message:
        action === 'DELETE'
          ? '账号已软删除'
          : action === 'RESTORE'
            ? '账号已恢复，请重新登录'
            : '账号已彻底删除',
    };
  }
}
