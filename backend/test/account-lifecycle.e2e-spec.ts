import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { io } from 'socket.io-client';

describe.sequential('account lifecycle HTTP contract', () => {
  let app: INestApplication, db: DatabaseService, jwt: JwtService;
  const prefix = 'lifecycle_' + randomUUID().slice(0, 8);
  const ids: string[] = [];
  const tokens: string[] = [];
  const password = 'Lifecycle-test-123!';
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who = 0,
  ) => {
    const client = request(app.getHttpServer());
    return client[method]('/api' + path).set(
      'Authorization',
      'Bearer ' + tokens[who],
    );
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    jwt = app.get(JwtService);
    for (const [i, role] of ['ADMIN', 'OPERATOR', 'OPERATOR'].entries()) {
      const u = await db.user.create({
        data: {
          username: prefix + i,
          email: prefix + i + '@example.invalid',
          passwordHash: await hash(password, 4),
          role: role as 'ADMIN' | 'OPERATOR',
        },
      });
      ids.push(u.id);
      tokens.push(await jwt.signAsync({ sub: u.id, tokenVersion: 0 }));
    }
  });
  afterAll(async () => {
    try {
      if (db) {
        await db.orderLog.deleteMany({
          where: { order: { creatorId: { in: ids } } },
        });
        await db.orderItem.deleteMany({
          where: { order: { creatorId: { in: ids } } },
        });
        await db.order.deleteMany({ where: { creatorId: { in: ids } } });
        await db.product.deleteMany({ where: { userId: { in: ids } } });
        await db.category.deleteMany({ where: { name: prefix } });
        await db.user.deleteMany({ where: { id: { in: ids } } });
        await db.role.deleteMany({ where: { code: prefix.toUpperCase() } });
      }
    } finally {
      await app?.close();
    }
  });
  it('soft deletes, rejects login and old credentials, restores without reviving old credentials', async () => {
    await api('delete', '/admin/users/' + ids[1])
      .send({ reason: '停用测试账号' })
      .expect(200);
    await api('get', '/users/me', 1).expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: prefix + 1, password })
      .expect(401);
    const active = await api('get', '/admin/users')
      .query({ search: prefix })
      .expect(200);
    expect(active.body.total).toBe(2);
    const deleted = await api('get', '/admin/users')
      .query({ search: prefix, status: 'deleted' })
      .expect(200);
    expect(deleted.body.total).toBe(1);
    expect(deleted.body.items[0].deleteReason).toBe('停用测试账号');
    expect(deleted.body.items[0]).not.toHaveProperty('tokenVersion');
    await api('post', '/admin/users/' + ids[1] + '/restore')
      .send({ reason: '恢复测试账号' })
      .expect(200);
    await api('get', '/users/me', 1).expect(401);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: prefix + 1, password })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/users/me')
      .auth(login.body.accessToken, { type: 'bearer' })
      .expect(200);
  });
  it('rejects self deletion, missing permission, invalid state, unknown fields and empty reason', async () => {
    await api('delete', '/admin/users/' + ids[0])
      .send({ reason: '自删' })
      .expect(400);
    await api('delete', '/admin/users/' + ids[2], 2)
      .send({ reason: '越权' })
      .expect(403);
    for (const body of [
      { reason: '' },
      { reason: ' ' },
      { reason: 'test', role: 'ADMIN' },
      { reason: 'test', creatorId: ids[0] },
    ])
      await api('delete', '/admin/users/' + ids[2])
        .send(body)
        .expect(400);
    await api('post', '/admin/users/' + ids[2] + '/restore')
      .send({ reason: 'test' })
      .expect(409);
    await api('delete', '/admin/users/' + ids[2] + '/purge')
      .send({ reason: 'test', username: prefix + 2 })
      .expect(409);
    await api('delete', '/admin/users/' + randomUUID())
      .send({ reason: 'test' })
      .expect(404);
    await api('get', '/admin/users').query({ status: 'anything' }).expect(400);
  });
  it('disconnects sockets after soft deletion and rejects stale profile/password writes', async () => {
    const socket = io(await app.getUrl(), {
      auth: { token: tokens[2] },
      reconnection: false,
      transports: ['websocket'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const disconnected = new Promise<void>((resolve) =>
        socket.once('disconnect', () => resolve()),
      );
      await api('delete', '/admin/users/' + ids[2])
        .send({ reason: '停用测试' })
        .expect(200);
      await disconnected;
      await api('patch', '/users/me', 2)
        .send({ email: 'changed@example.invalid' })
        .expect(401);
      await api('patch', '/admin/users/' + ids[2] + '/role')
        .send({ role: 'ADMIN' })
        .expect(404);
      await api('delete', '/admin/users/' + ids[2])
        .send({ reason: '重复' })
        .expect(409);
    } finally {
      socket.disconnect();
    }
  });
  it('permanently deletes only empty soft-deleted accounts and preserves the audit and UUID tombstone', async () => {
    await api('delete', '/admin/users/' + ids[2] + '/purge')
      .send({ username: 'wrong', reason: 'test' })
      .expect(400);
    const preflight = await api(
      'get',
      '/admin/users/' + ids[2] + '/dependencies',
    ).expect(200);
    expect(preflight.body).toEqual({
      productCount: 0,
      orderCount: 0,
      canPurge: true,
    });
    await api('delete', '/admin/users/' + ids[2] + '/purge')
      .send({ username: prefix + 2, reason: '清理空账号' })
      .expect(200);
    expect(await db.user.findUnique({ where: { id: ids[2] } })).toBeNull();
    expect(
      await db.userTombstone.findUnique({ where: { id: ids[2] } }),
    ).not.toBeNull();
    const audits = await db.accountAudit.findMany({
      where: { targetId: ids[2] },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual(['DELETE', 'PURGE']);
    await api('delete', '/admin/users/' + ids[2] + '/purge')
      .send({ username: prefix + 2, reason: '重复清理' })
      .expect(404);
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: prefix + 2,
        email: prefix + 2 + '@example.invalid',
        password,
      })
      .expect(201);
    expect(registered.body.user.id).not.toBe(ids[2]);
    ids.push(registered.body.user.id);
  });
  it('retains products and completed orders; neither association permits hard deletion', async () => {
    const category = await db.category.create({ data: { name: prefix } });
    const product = await db.product.create({
      data: {
        name: prefix,
        userId: ids[1],
        categoryId: category.id,
        price: '10',
        stock: 3,
      },
    });
    await api('delete', '/admin/users/' + ids[1])
      .send({ reason: '有业务的账号' })
      .expect(200);
    await api('delete', '/admin/users/' + ids[1] + '/purge')
      .send({ username: prefix + 1, reason: 'test' })
      .expect(409);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock,
    ).toBe(3);
    await db.product.delete({ where: { id: product.id } });
    await db.order.create({
      data: {
        orderNo: prefix,
        creatorId: ids[1],
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
        customerName: 'fixture',
        phone: '123456789',
        address: 'fixture',
        status: 'COMPLETED',
        totalAmount: '1',
        carrier: 'fixture',
        trackingNo: 'fixture',
        confirmedAt: new Date(),
        shippedAt: new Date(),
        completedAt: new Date(),
      },
    });
    const p = await api(
      'get',
      '/admin/users/' + ids[1] + '/dependencies',
    ).expect(200);
    expect(p.body).toEqual({ productCount: 0, orderCount: 1, canPurge: false });
    await api('delete', '/admin/users/' + ids[1] + '/purge')
      .send({ username: prefix + 1, reason: 'test' })
      .expect(409);
  });
  it('requires system ADMIN in addition to purge permission and blocks superior-role deletion', async () => {
    const role = await db.role.create({
      data: {
        code: prefix.toUpperCase(),
        name: '委派测试',
        grants: {
          create: [
            'user:read',
            'user:purge',
            'user:delete',
            'user:restore',
          ].map((permissionCode) => ({ permissionCode, scope: 'ALL' })),
        },
      },
    });
    const u = await db.user.create({
      data: {
        username: prefix + '_delegate',
        email: prefix + '_delegate@example.invalid',
        passwordHash: 'fixture',
        roleId: role.id,
      },
    });
    ids.push(u.id);
    const delegateToken = await jwt.signAsync({ sub: u.id, tokenVersion: 0 });
    for (const path of [
      '/admin/users/' + ids[1] + '/purge',
      '/admin/users/' + ids[0],
    ])
      await request(app.getHttpServer())
        .delete('/api' + path)
        .auth(delegateToken, { type: 'bearer' })
        .send(
          path.endsWith('/purge')
            ? { username: prefix + 1, reason: 'test' }
            : { reason: 'test' },
        )
        .expect(403);
  });
  it('documents state filtering, strict input and lifecycle endpoints in OpenAPI', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(
      doc.paths['/api/admin/users/{id}/purge'].delete?.security,
    ).toBeDefined();
    expect(
      doc.paths['/api/admin/users/{id}/restore'].post?.responses,
    ).toHaveProperty('200');
    expect(doc.components?.schemas?.PurgeAccountDto.required).toEqual(
      expect.arrayContaining(['reason', 'username']),
    );
    expect(doc.components?.schemas?.AdminUserDto.properties).toHaveProperty(
      'deletedAt',
    );
  });
});
