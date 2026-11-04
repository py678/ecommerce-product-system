import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PUBLIC_USER_SELECT, publicUser } from '../auth/public-user.js';
import type { Actor } from '../auth/permissions.js';
import type {
  AdminUserQueryDto,
  AssignRoleDto,
  AdminUserPageDto,
} from './dto/admin-user.dto.js';
@Injectable()
export class AdminUsersService {
  constructor(private readonly db: DatabaseService) {}
  async list(query: AdminUserQueryDto): Promise<AdminUserPageDto> {
    const where: Prisma.UserWhereInput = {
      role: query.role,
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
    return this.db.$transaction(async (tx) => {
      // Serialize role changes and bootstrap; READ COMMITTED rechecks after taking the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73510943)`;
      const currentActor = await tx.user.findUnique({
        where: { id: actor.id },
        select: { role: true },
      });
      if (currentActor?.role !== 'ADMIN')
        throw new ForbiddenException('没有执行此操作的权限');
      const target = await tx.user.findUnique({
        where: { id },
        select: { role: true },
      });
      if (!target) throw new NotFoundException('账号不存在');
      if (
        target.role === 'ADMIN' &&
        dto.role !== 'ADMIN' &&
        (await tx.user.count({ where: { role: 'ADMIN' } })) <= 1
      )
        throw new ConflictException('不能降级最后一个管理员');
      if (target.role === dto.role)
        throw new BadRequestException('角色未发生变化');
      const user = await tx.user.update({
        where: { id },
        data: { role: dto.role, tokenVersion: { increment: 1 } },
        select: PUBLIC_USER_SELECT,
      });
      await tx.roleAudit.create({
        data: {
          actorId: actor.id,
          targetId: id,
          fromRole: target.role,
          toRole: dto.role,
        },
      });
      return publicUser(user);
    });
  }
}
