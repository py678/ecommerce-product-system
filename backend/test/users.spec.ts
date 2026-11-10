import type { RealtimeService } from '../dist/realtime/realtime.service.js';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { compare, hash, getRounds } from 'bcryptjs';
import { UsersService } from '../dist/users/users.service.js';
import {
  ChangePasswordDto,
  UpdateProfileDto,
} from '../dist/users/dto/user.dto.js';
import { publicUser } from '../dist/auth/public-user.js';
import type { DatabaseService } from '../dist/database/database.service.js';

describe('Personal centre validation and password transaction', () => {
  const oldPassword = 'Original-password-123!';
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hash(oldPassword, 12);
  });
  function setup(count = 1) {
    const write = vi.fn().mockResolvedValue({ count });
    const db = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ passwordHash, tokenVersion: 2 }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ user: { updateMany: write } }),
      ),
    };
    return {
      service: new UsersService(
        db as unknown as DatabaseService,
        { revokeUser: vi.fn() } as unknown as RealtimeService,
      ),
      write,
      db,
    };
  }
  it('rejects wrong original password without opening a write transaction', async () => {
    const { service, db } = setup();
    await expect(
      service.changePassword('id', {
        oldPassword: 'Wrong-password-123!',
        newPassword: 'Changed-password-456!',
      }),
    ).rejects.toThrow('原密码错误');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects reuse without a write', async () => {
    const { service, db } = setup();
    await expect(
      service.changePassword('id', { oldPassword, newPassword: oldPassword }),
    ).rejects.toThrow('新密码不得与原密码相同');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('atomically stores BCrypt and increments the version with a concurrency condition', async () => {
    const { service, write } = setup();
    const result = await service.changePassword('id', {
      oldPassword,
      newPassword: 'Changed-password-456!',
    });
    expect(result).toEqual({ message: '密码已修改，请重新登录' });
    const args = write.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'id', passwordHash, tokenVersion: 2 });
    expect(args.data.tokenVersion).toEqual({ increment: 1 });
    expect(getRounds(args.data.passwordHash)).toBe(12);
    expect(await compare('Changed-password-456!', args.data.passwordHash)).toBe(
      true,
    );
  });
  it('rejects a concurrent change instead of overwriting the winning password', async () => {
    const { service } = setup(0);
    await expect(
      service.changePassword('id', {
        oldPassword,
        newPassword: 'Changed-password-456!',
      }),
    ).rejects.toThrow('密码已修改，请重新登录');
  });
  it.each([
    'short1',
    'abcdefgh',
    '12345678',
    'A1' + 'x'.repeat(31),
    '字'.repeat(25) + 'A1',
  ])('rejects invalid new password %#', async (newPassword) => {
    const errors = await validate(
      plainToInstance(ChangePasswordDto, { oldPassword, newPassword }),
    );
    expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
  });
  it.each([
    'userId',
    'username',
    'role',
    'roleId',
    'roleName',
    'status',
    'password',
    'passwordHash',
    'tokenVersion',
    'nickname',
    'avatar',
  ])('rejects non-whitelisted profile field %s', async (field) => {
    expect(
      (
        await validate(
          plainToInstance(UpdateProfileDto, {
            email: 'new@example.invalid',
            [field]: 'forbidden',
          }),
          { whitelist: true, forbidNonWhitelisted: true },
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('normalizes email and explicitly excludes all internal fields from public users', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      email: ' NEW@EXAMPLE.COM ',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.email).toBe('new@example.com');
    const user = {
      id: 'id',
      username: 'name',
      role: 'OPERATOR' as const,
      roleId: 'role',
      roleDefinition: {
        code: 'OPERATOR',
        name: '运营人员',
        enabled: true,
        grants: [],
      },
      email: dto.email,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash,
      tokenVersion: 5,
    };
    expect(Object.keys(publicUser(user)).sort()).toEqual([
      'createdAt',
      'dataScopes',
      'email',
      'id',
      'permissions',
      'role',
      'roleId',
      'roleName',
      'updatedAt',
      'username',
    ]);
  });
});
