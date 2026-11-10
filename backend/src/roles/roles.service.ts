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
import type { Actor, Permission } from '../auth/permissions.js';
import { CommerceAuthorityService } from '../commerce/commerce.module.js';
import {
  RealtimeService,
  notifySessionChange,
} from '../realtime/realtime.service.js';
import type {
  CreateRoleDto,
  RoleGrantDto,
  RoleQueryDto,
  UpdateRoleDto,
} from './dto/role.dto.js';
export const ROLE_INCLUDE = {
  grants: { orderBy: { permissionCode: 'asc' as const } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;
type RoleRecord = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;
export function roleResponse(r: RoleRecord) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    system: r.system,
    version: r.version,
    userCount: r._count.users,
    grants: r.grants.map((g) => ({
      permission: g.permissionCode as Permission,
      scope: g.scope,
    })),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
export async function lockRoleAuthority(
  tx: Prisma.TransactionClient,
  actor: Actor,
  permission: Permission,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(73510943)`;
  const row = await tx.user.findUnique({
    where: { id: actor.id },
    select: PUBLIC_USER_SELECT,
  });
  if (!row?.roleDefinition.enabled)
    throw new ForbiddenException('没有执行此操作的权限');
  const current = publicUser(row);
  if (!current.permissions.includes(permission))
    throw new ForbiddenException('没有执行此操作的权限');
  return current;
}
// A delegated manager may only grant capabilities and scopes they already possess.
export function assertCanGrant(
  actor: Actor,
  grants: readonly RoleGrantDto[],
  reservedAdmin = false,
) {
  if (reservedAdmin && actor.role !== 'ADMIN')
    throw new ForbiddenException('不能授予系统管理员角色');
  for (const g of grants)
    if (
      !actor.permissions?.includes(g.permission) ||
      (g.scope === 'ALL' && actor.dataScopes?.[g.permission] !== 'ALL')
    )
      throw new ForbiddenException('不能授予超出自身范围的权限');
}
@Injectable()
export class RolesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly authority: CommerceAuthorityService,
    private readonly realtime: RealtimeService,
  ) {}
  catalog() {
    return this.db.permissionDefinition.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
  }
  async list(q: RoleQueryDto) {
    const where: Prisma.RoleWhereInput = q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { code: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.db.$transaction(
      [
        this.db.role.findMany({
          where,
          include: ROLE_INCLUDE,
          orderBy: [{ system: 'desc' }, { code: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        this.db.role.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: items.map(roleResponse),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async options() {
    return this.db.role.findMany({
      where: { enabled: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }
  async get(id: string) {
    const role = await this.db.role.findUnique({
      where: { id },
      include: ROLE_INCLUDE,
    });
    if (!role) throw new NotFoundException('角色不存在');
    return roleResponse(role);
  }
  private async validateGrants(
    tx: Prisma.TransactionClient,
    grants: RoleGrantDto[],
  ) {
    const definitions = await tx.permissionDefinition.findMany();
    const map = new Map(definitions.map((p) => [p.code, p]));
    const selected = new Map(grants.map((g) => [g.permission, g]));
    for (const g of grants) {
      const p = map.get(g.permission);
      if (!p || (!p.scoped && g.scope !== 'ALL'))
        throw new BadRequestException('权限点或数据范围无效');
      const resource = g.permission.split(':')[0];
      if (
        ['product', 'category', 'order', 'role', 'user'].includes(resource) &&
        !g.permission.endsWith(':read') &&
        !selected.has((resource + ':read') as Permission)
      )
        throw new BadRequestException('操作权限必须同时具有对应查看权限');
      if (g.permission === 'product:create' && !selected.has('category:read'))
        throw new BadRequestException('创建商品需要查看分类权限');
      if (g.permission === 'order:create' && !selected.has('product:read'))
        throw new BadRequestException('创建订单需要查看商品权限');
      if (
        p.scoped &&
        !g.permission.endsWith(':read') &&
        g.scope === 'ALL' &&
        selected.get((resource + ':read') as Permission)?.scope !== 'ALL'
      )
        throw new BadRequestException(
          '全部数据操作必须同时具有全部数据查看范围',
        );
    }
  }
  private translate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException('角色编码已存在');
      if (error.code === 'P2003')
        throw new ConflictException('角色仍有关联数据，不能删除');
    }
    throw error;
  }
  async create(actor: Actor, dto: CreateRoleDto) {
    await this.authority.requireWriter();
    try {
      return await this.db.$transaction(async (tx) => {
        const current = await lockRoleAuthority(tx, actor, 'role:create');
        await this.validateGrants(tx, dto.grants);
        assertCanGrant(current, dto.grants);
        const role = await tx.role.create({
          data: {
            code: dto.code,
            name: dto.name,
            description: dto.description,
            grants: {
              create: dto.grants.map((g) => ({
                permissionCode: g.permission,
                scope: g.scope,
              })),
            },
          },
          include: ROLE_INCLUDE,
        });
        const result = roleResponse(role);
        await tx.permissionAudit.create({
          data: {
            actorId: actor.id,
            roleId: role.id,
            action: 'CREATE',
            after: result as unknown as Prisma.InputJsonValue,
          },
        });
        return result;
      });
    } catch (e) {
      return this.translate(e);
    }
  }
  async update(actor: Actor, id: string, dto: UpdateRoleDto) {
    await this.authority.requireWriter();
    let revoked: string[] = [];
    try {
      const result = await this.db.$transaction(async (tx) => {
        const current = await lockRoleAuthority(tx, actor, 'role:update');
        const before = await tx.role.findUnique({
          where: { id },
          include: ROLE_INCLUDE,
        });
        if (!before) throw new NotFoundException('角色不存在');
        if (before.code === 'ADMIN')
          throw new BadRequestException('系统管理员角色不可修改');
        if (current.roleId === id)
          throw new BadRequestException('不能修改自己所属角色');
        if (before.system && dto.enabled === false)
          throw new BadRequestException('默认注册角色不能停用');
        if (dto.code !== undefined && dto.code !== before.code)
          throw new BadRequestException('角色编码创建后不可修改');
        if (dto.version !== before.version)
          throw new ConflictException('角色已变化，请刷新后重试');
        if (
          dto.name === undefined &&
          dto.description === undefined &&
          dto.enabled === undefined &&
          dto.grants === undefined
        )
          throw new BadRequestException('请提供可更新字段');
        const grants =
          dto.grants ??
          before.grants.map((g) => ({
            permission: g.permissionCode as Permission,
            scope: g.scope,
          }));
        await this.validateGrants(tx, grants);
        assertCanGrant(
          current,
          before.grants.map((g) => ({
            permission: g.permissionCode as Permission,
            scope: g.scope,
          })),
        );
        assertCanGrant(current, grants);
        if (dto.grants !== undefined) {
          await tx.rolePermission.deleteMany({ where: { roleId: id } });
          await tx.rolePermission.createMany({
            data: grants.map((g) => ({
              roleId: id,
              permissionCode: g.permission,
              scope: g.scope,
            })),
          });
        }
        const role = await tx.role.update({
          where: { id, version: dto.version },
          data: {
            name: dto.name,
            description: dto.description,
            enabled: dto.enabled,
            version: { increment: 1 },
          },
          include: ROLE_INCLUDE,
        });
        revoked = (
          await tx.user.findMany({
            where: { roleId: id },
            select: { id: true },
          })
        ).map((u) => u.id);
        await tx.user.updateMany({
          where: { roleId: id },
          data: { tokenVersion: { increment: 1 } },
        });
        const response = roleResponse(role);
        await tx.permissionAudit.create({
          data: {
            actorId: actor.id,
            roleId: id,
            action: 'UPDATE',
            before: roleResponse(before) as unknown as Prisma.InputJsonValue,
            after: response as unknown as Prisma.InputJsonValue,
          },
        });
        return response;
      });
      for (const userId of revoked)
        notifySessionChange(this.realtime, userId, 'securityChanged');
      return result;
    } catch (e) {
      return this.translate(e);
    }
  }
  async remove(actor: Actor, id: string) {
    await this.authority.requireWriter();
    try {
      await this.db.$transaction(async (tx) => {
        const current = await lockRoleAuthority(tx, actor, 'role:delete');
        const before = await tx.role.findUnique({
          where: { id },
          include: ROLE_INCLUDE,
        });
        if (!before) throw new NotFoundException('角色不存在');
        if (before.system) throw new BadRequestException('系统角色不能删除');
        if (current.roleId === id)
          throw new BadRequestException('不能删除自己所属角色');
        if (before._count.users)
          throw new ConflictException('请先重新分配该角色下的用户');
        assertCanGrant(
          current,
          before.grants.map((g) => ({
            permission: g.permissionCode as Permission,
            scope: g.scope,
          })),
        );
        await tx.role.delete({ where: { id } });
        await tx.permissionAudit.create({
          data: {
            actorId: actor.id,
            roleId: id,
            action: 'DELETE',
            before: roleResponse(before) as unknown as Prisma.InputJsonValue,
          },
        });
      });
    } catch (e) {
      this.translate(e);
    }
  }
  async audits(id: string, q: RoleQueryDto) {
    const where = { roleId: id };
    const [items, total] = await this.db.$transaction(
      [
        this.db.permissionAudit.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        this.db.permissionAudit.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
