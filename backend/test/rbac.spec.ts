import type { RealtimeService } from '../dist/realtime/realtime.service.js';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from '../dist/auth/permissions.guard.js';
import {
  PERMISSION_KEY,
  ROLE_PERMISSIONS,
  productScope,
} from '../dist/auth/permissions.js';
import { AdminUsersService } from '../dist/admin/admin-users.service.js';
import type { DatabaseService } from '../dist/database/database.service.js';
describe('RBAC fail-closed permissions and role transaction', () => {
  it('defines exactly two roles with operator ownership restrictions', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['ADMIN', 'OPERATOR']);
    expect(ROLE_PERMISSIONS.OPERATOR).toContain('product:create');
    expect(productScope({ id: 'me', role: 'OPERATOR' })).toEqual({
      userId: 'me',
    });
    expect(productScope({ id: 'me', role: 'ADMIN' })).toEqual({});
  });
  it('denies missing permission metadata and forged role names', () => {
    const reflector = new Reflector();
    const guard = new PermissionsGuard(reflector);
    const handler = () => undefined;
    const context = {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'ROOT' } }) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(context)).toThrow('没有执行此操作的权限');
    Reflect.defineMetadata(PERMISSION_KEY, ['product:read'], handler);
    expect(() => guard.canActivate(context)).toThrow('没有执行此操作的权限');
  });
  function setup(actorRole = 'ADMIN', targetRole = 'ADMIN', count = 1) {
    const update = vi.fn(),
      audit = vi.fn();
    const tx = {
      $executeRaw: vi.fn(),
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ role: actorRole })
          .mockResolvedValueOnce({ role: targetRole }),
        count: vi.fn().mockResolvedValue(count),
        update,
      },
      roleAudit: { create: audit },
    };
    const db = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    };
    return {
      service: new AdminUsersService(
        db as unknown as DatabaseService,
        { revokeUser: vi.fn() } as unknown as RealtimeService,
      ),
      tx,
      db,
      update,
      audit,
    };
  }
  it('prevents demotion of the final administrator before any write', async () => {
    const { service, update, audit } = setup();
    await expect(
      service.assignRole({ id: 'actor', role: 'ADMIN' }, 'target', {
        role: 'OPERATOR',
      }),
    ).rejects.toThrow('不能降级最后一个管理员');
    expect(update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it('rechecks actor authority inside the serialized transaction', async () => {
    const { service, update } = setup('OPERATOR');
    await expect(
      service.assignRole({ id: 'actor', role: 'ADMIN' }, 'target', {
        role: 'OPERATOR',
      }),
    ).rejects.toThrow('没有执行此操作的权限');
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects self changes before opening a transaction', async () => {
    const { service, db } = setup();
    await expect(
      service.assignRole({ id: 'actor', role: 'ADMIN' }, 'actor', {
        role: 'OPERATOR',
      }),
    ).rejects.toThrow('不能修改自己的角色');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('propagates audit failure to the transaction for rollback', async () => {
    // Real transaction rollback is covered by the database-backed test.
    const { service, tx, update, audit } = setup('ADMIN', 'ADMIN', 2);
    update.mockResolvedValue({
      id: 'target',
      username: 'test',
      email: 'test@example.invalid',
      role: 'OPERATOR',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      service.assignRole({ id: 'actor', role: 'ADMIN' }, 'target', {
        role: 'OPERATOR',
      }),
    ).rejects.toThrow('audit unavailable');
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: 'OPERATOR', tokenVersion: { increment: 1 } },
      }),
    );
  });
});
