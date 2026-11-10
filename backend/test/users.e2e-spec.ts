import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { hash, compare, getRounds } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { DatabaseService } from '../dist/database/database.service.js';

describe.sequential('Personal centre HTTP API', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwt: JwtService;
  const prefix = `profile_${randomUUID().slice(0, 8)}`;
  const original = 'Original-password-123!';
  const next = 'Changed-password-456!';
  const ids: string[] = [];
  let owner: { id: string; username: string; email: string };
  let other: typeof owner;
  let token: string;
  async function account(suffix: string) {
    const user = await db.user.create({
      data: {
        username: `${prefix}_${suffix}`,
        email: `${prefix}_${suffix}@example.invalid`,
        passwordHash: await hash(original, 12),
      },
    });
    ids.push(user.id);
    return { id: user.id, username: user.username, email: user.email };
  }
  function api(method: 'get' | 'patch', path: string, auth = token) {
    const client = request(app.getHttpServer());
    return client[method](path).set('Authorization', `Bearer ${auth}`);
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    jwt = app.get(JwtService);
    owner = await account('owner');
    other = await account('other');
    token = await jwt.signAsync({ sub: owner.id, tokenVersion: 0 });
  });
  afterAll(async () => {
    try {
      if (db) await db.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      if (app) await app.close();
    }
  });
  it('returns only public fields and requires a session', async () => {
    const r = await api('get', '/api/users/me').expect(200);
    expect(r.body).toMatchObject(owner);
    expect(Object.keys(r.body).sort()).toEqual([
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
    expect(r.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });
  it.each(['/api/users/me', '/api/users/me/password'])(
    'rejects query-supplied identity on %s',
    async (path) => {
      if (path.endsWith('password'))
        await api('patch', path)
          .query({ userId: other.id })
          .send({ oldPassword: original, newPassword: next })
          .expect(400);
      else {
        await api('get', path).query({ userId: other.id }).expect(400);
        await api('patch', path)
          .query({ userId: other.id })
          .send({ email: 'unused@example.invalid' })
          .expect(400);
      }
    },
  );
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
  ])('rejects profile mass assignment %s', async (field) => {
    await api('patch', '/api/users/me')
      .send({ email: owner.email, [field]: other.id })
      .expect(400);
  });
  it('edits only the current email, normalizes it and handles duplicate/concurrent emails', async () => {
    const email = `${prefix}_edited@example.invalid`;
    const r = await api('patch', '/api/users/me')
      .send({ email: ` ${email.toUpperCase()} ` })
      .expect(200);
    expect(r.body.email).toBe(email);
    expect(r.body.username).toBe(owner.username);
    expect(r.body.tokenVersion).toBeUndefined();
    await api('patch', '/api/users/me')
      .send({ email: other.email })
      .expect(409);
    await api('patch', '/api/users/me').send({}).expect(400);
    const otherToken = await jwt.signAsync({ sub: other.id, tokenVersion: 0 });
    const shared = `${prefix}_shared@example.invalid`;
    const responses = await Promise.all(
      [token, otherToken].map((t) =>
        api('patch', '/api/users/me', t).send({ email: shared }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('leaves credentials valid after wrong original password or same-password attempts', async () => {
    const r = await api('patch', '/api/users/me/password')
      .send({ oldPassword: 'Wrong-password-123!', newPassword: next })
      .expect(400);
    expect(r.body.message).toBe('原密码错误');
    await api('patch', '/api/users/me/password')
      .send({ oldPassword: original, newPassword: original })
      .expect(400);
    await api('get', '/api/users/me').expect(200);
    const stored = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(stored.tokenVersion).toBe(0);
    expect(await compare(original, stored.passwordHash)).toBe(true);
  });
  it.each([
    'short1',
    'abcdefgh',
    '12345678',
    'x'.repeat(33) + '1',
    '字'.repeat(25) + 'A1',
  ])('rejects weak new password %#', async (newPassword) => {
    await api('patch', '/api/users/me/password')
      .send({ oldPassword: original, newPassword })
      .expect(400);
  });
  it('rejects extra password fields and missing/invalid token version claims', async () => {
    await api('patch', '/api/users/me/password')
      .send({ oldPassword: original, newPassword: next, userId: other.id })
      .expect(400);
    for (const payload of [
      { sub: owner.id },
      { sub: owner.id, tokenVersion: -1 },
      { sub: owner.id, tokenVersion: '0' },
      { sub: owner.id, tokenVersion: 0.5 },
      { sub: owner.id, tokenVersion: 1 },
    ])
      await api('get', '/api/users/me', await jwt.signAsync(payload)).expect(
        401,
      );
  });
  it('login → change password → all old tokens fail → new login works', async () => {
    const user = await account('change');
    const login = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: user.username, password: original });
    const first = await login().expect(200),
      second = await login().expect(200);
    const changed = await api(
      'patch',
      '/api/users/me/password',
      first.body.accessToken,
    )
      .send({ oldPassword: original, newPassword: next })
      .expect(200);
    expect(changed.body).toEqual({ message: '密码已修改，请重新登录' });
    for (const old of [first.body.accessToken, second.body.accessToken]) {
      for (const path of [
        '/api/users/me',
        '/api/auth/me',
        '/api/products',
        '/api/categories',
      ]) {
        const r = await api('get', path, old).expect(401);
        expect(r.body.message).toBe('账号安全信息已变更，请重新登录');
      }
      await request(app.getHttpServer())
        .post('/api/upload/image')
        .set('Authorization', `Bearer ${old}`)
        .expect(401);
    }
    await login().expect(401);
    const fresh = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: user.username, password: next })
      .expect(200);
    expect((await jwt.verifyAsync(fresh.body.accessToken)).tokenVersion).toBe(
      1,
    );
    expect(fresh.body.user.tokenVersion).toBeUndefined();
    await api('get', '/api/users/me', fresh.body.accessToken).expect(200);
    await api('get', '/api/products', fresh.body.accessToken).expect(200);
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.tokenVersion).toBe(1);
    expect(getRounds(stored.passwordHash)).toBe(12);
    expect(await compare(next, stored.passwordHash)).toBe(true);
  });
  it('allows only one of two simultaneous changes using the original password', async () => {
    const user = await account('race');
    const auth = await jwt.signAsync({ sub: user.id, tokenVersion: 0 });
    const results = await Promise.all(
      [next, 'Different-password-789!'].map((newPassword) =>
        api('patch', '/api/users/me/password', auth).send({
          oldPassword: original,
          newPassword,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect([400, 401]).toContain(results.find((r) => r.status !== 200)!.status);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
        .tokenVersion,
    ).toBe(1);
  });
  it('limits password attempts to five per minute per IP without locking the account', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const limited = module.createNestApplication();
    configureApp(limited);
    await limited.init();
    try {
      for (let i = 0; i < 5; i++)
        await request(limited.getHttpServer())
          .patch('/api/users/me/password')
          .set('Authorization', `Bearer ${token}`)
          .send({ oldPassword: 'Wrong-password-123!', newPassword: next })
          .expect(400);
      await request(limited.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: original, newPassword: next })
        .expect(429);
      await request(limited.getHttpServer())
        .post('/api/auth/login')
        .send({ username: owner.username, password: original })
        .expect(200);
    } finally {
      await limited.close();
    }
  });
  it('documents protected routes, write-only input and safe response schemas', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    for (const [path, method] of [
      ['/api/users/me', 'get'],
      ['/api/users/me', 'patch'],
      ['/api/users/me/password', 'patch'],
    ])
      expect(body.paths[path][method].security).toEqual([{ bearer: [] }]);
    expect(
      body.components.schemas.ChangePasswordDto.properties.newPassword
        .writeOnly,
    ).toBe(true);
    expect(
      body.components.schemas.UserResponseDto.properties.tokenVersion,
    ).toBeUndefined();
    expect(
      body.components.schemas.UserResponseDto.properties.passwordHash,
    ).toBeUndefined();
  });
});
