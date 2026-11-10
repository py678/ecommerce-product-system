import {
  RealtimeService,
  notifySessionChange,
} from '../realtime/realtime.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { CommerceAuthorityService } from '../commerce/commerce.module.js';
import { Prisma } from '../generated/prisma/client.js';
import { PUBLIC_USER_SELECT, publicUser } from '../auth/public-user.js';
import type { Actor, Permission } from '../auth/permissions.js';
import { assertCanGrant, lockRoleAuthority } from '../roles/roles.service.js';
import type {
  AdminUserQueryDto,
  AssignRoleDto,
  AdminUserPageDto,
} from './dto/admin-user.dto.js';
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
  ) {}
  async list(query: AdminUserQueryDto): Promise<AdminUserPageDto> {
    const where: Prisma.UserWhereInput = {
      roleId: query.roleId,
      ...(query.role ? { roleDefinition: { code: query.role } } : {}),
      ...(query.search
        ? {
            OR: [
              { username: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [users, total] = await this.db.$transaction(
      [
        this.db.user.findMany({
          where,
          select: PUBLIC_USER_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.user.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: users.map(publicUser),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
  async assignRole(actor: Actor, id: string, dto: AssignRoleDto) {
    if (actor.id === id) throw new BadRequestException('不能修改自己的角色');
    if ((dto.roleId === undefined) === (dto.role === undefined))
      throw new BadRequestException(
        '请只提供 roleId；旧客户端可使用 role 编码',
      );
    await new CommerceAuthorityService(this.db).requireWriter();
    const updated = await this.db.$transaction(async (tx) => {
      const current = await lockRoleAuthority(tx, actor, 'user:assign-role');
      const target = await tx.user.findUnique({
        where: { id },
        select: PUBLIC_USER_SELECT,
      });
      if (!target) throw new NotFoundException('账号不存在');
      const role = await tx.role.findUnique({
        where: dto.roleId ? { id: dto.roleId } : { code: dto.role! },
        include: { grants: true },
      });
      if (!role || !role.enabled)
        throw new BadRequestException('目标角色不存在或已停用');
      if (target.roleId === role.id)
        throw new BadRequestException('角色未发生变化');
      assertCanGrant(
        current,
        target.roleDefinition.grants.map((g) => ({
          permission: g.permissionCode as Permission,
          scope: g.scope,
        })),
        target.roleDefinition.code === 'ADMIN',
      );
      assertCanGrant(
        current,
        role.grants.map((g) => ({
          permission: g.permissionCode as Permission,
          scope: g.scope,
        })),
        role.code === 'ADMIN',
      );
      if (
        target.roleDefinition.code === 'ADMIN' &&
        (await tx.user.count({
          where: { roleDefinition: { code: 'ADMIN', enabled: true } },
        })) <= 1
      )
        throw new ConflictException('不能降级最后一个管理员');
      const user = await tx.user.update({
        where: { id },
        data: {
          roleId: role.id,
          role: role.code === 'ADMIN' ? 'ADMIN' : 'OPERATOR',
          tokenVersion: { increment: 1 },
        },
        select: PUBLIC_USER_SELECT,
      });
      await tx.roleAudit.create({
        data: {
          actorId: actor.id,
          targetId: id,
          fromRole: target.roleDefinition.code,
          toRole: role.code,
        },
      });
      await tx.permissionAudit.create({
        data: {
          actorId: actor.id,
          roleId: role.id,
          action: 'ASSIGN_USER',
          before: { userId: id, roleId: target.roleId },
          after: { userId: id, roleId: role.id },
        },
      });
      return publicUser(user);
    });
    notifySessionChange(this.realtime, id, 'securityChanged');
    return updated;
  }
}
