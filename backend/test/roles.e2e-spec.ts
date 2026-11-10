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

// This suite is executed only through the random-schema verification runner.
describe.sequential('Configurable role workflow', () => {
  let app: INestApplication,
    db: DatabaseService,
    token: string,
    adminId: string,
    targetId: string,
    targetToken: string,
    categoryId: string,
    ownId: string,
    foreignId: string;
  let role: { id: string; version: number };
  const roleIds: string[] = [],
    userIds: string[] = [];
  const prefix = 'roles_' + randomUUID().slice(0, 8);
  const password = 'Roles-test-password-123!';
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    url: string,
    auth = token,
  ) => {
    const client = request(app.getHttpServer());
    return client[method](url).set('Authorization', 'Bearer ' + auth);
  };
  async function login() {
    const r = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: prefix + '_target', password, loginRole: 'OPERATOR' })
      .expect(200);
    targetToken = r.body.accessToken;
    return r.body.user;
  }
  async function create(code: string, grants: object[]) {
    const r = await call('post', '/api/admin/roles')
      .send({ code: prefix.toUpperCase() + '_' + code, name: code, grants })
      .expect(201);
    roleIds.push(r.body.id);
    return r.body;
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    for (const name of ['admin', 'target']) {
      const user = await db.user.create({
        data: {
          username: prefix + '_' + name,
          email: prefix + '_' + name + '@example.invalid',
          passwordHash: await hash(password, 12),
          role: name === 'admin' ? 'ADMIN' : 'OPERATOR',
        },
      });
      userIds.push(user.id);
      if (name === 'admin') adminId = user.id;
      else targetId = user.id;
    }
    token = await app
      .get(JwtService)
      .signAsync({ sub: adminId, tokenVersion: 0 });
    categoryId = (await db.category.create({ data: { name: prefix } })).id;
    for (const owner of [targetId, adminId]) {
      const p = await db.product.create({
        data: {
          name: prefix,
          userId: owner,
          categoryId,
          price: '10.00',
          stock: 5,
        },
      });
      if (owner === targetId) ownId = p.id;
      else foreignId = p.id;
    }
  });
  afterAll(async () => {
    try {
      if (db) {
        await db.orderLog.deleteMany({
          where: { order: { creatorId: { in: userIds } } },
        });
        await db.orderItem.deleteMany({
          where: { order: { creatorId: { in: userIds } } },
        });
        await db.order.deleteMany({ where: { creatorId: { in: userIds } } });
        await db.product.deleteMany({ where: { userId: { in: userIds } } });
        if (categoryId) await db.category.delete({ where: { id: categoryId } });
        await db.user.deleteMany({ where: { id: { in: userIds } } });
        await db.role.deleteMany({ where: { id: { in: roleIds } } });
        await db.roleAudit.deleteMany({ where: { targetId: { in: userIds } } });
        await db.permissionAudit.deleteMany({
          where: { actorId: { in: userIds } },
        });
      }
    } finally {
      await app?.close();
    }
  });
  it('provides a fixed catalog, rejects invalid grants and strict-whitelist fields', async () => {
    const c = await call('get', '/api/admin/roles/permissions').expect(200);
    expect(c.body).toHaveLength(24);
    for (const grants of [
      [{ permission: 'product:drop', scope: 'ALL' }],
      [{ permission: 'category:read', scope: 'OWN' }],
      [{ permission: 'product:update', scope: 'OWN' }],
      [
        { permission: 'product:read', scope: 'OWN' },
        { permission: 'product:update', scope: 'ALL' },
      ],
      [
        { permission: 'product:read', scope: 'ALL' },
        { permission: 'product:read', scope: 'OWN' },
      ],
    ])
      await call('post', '/api/admin/roles')
        .send({ code: prefix.toUpperCase(), name: 'invalid', grants })
        .expect(400);
    await call('post', '/api/admin/roles')
      .send({
        code: prefix.toUpperCase(),
        name: 'invalid',
        grants: [],
        creatorId: adminId,
      })
      .expect(400);
  });
  it('creates role first, assigns a user and revokes the old token', async () => {
    await login();
    const old = targetToken;
    role = await create('READ', [{ permission: 'product:read', scope: 'OWN' }]);
    await call('patch', '/api/admin/users/' + targetId + '/role')
      .send({ roleId: role.id })
      .expect(200);
    await call('get', '/api/products', old).expect(401);
    const profile = await login();
    expect(profile).toMatchObject({
      roleId: role.id,
      role: prefix.toUpperCase() + '_READ',
      dataScopes: { 'product:read': 'OWN' },
    });
    for (const field of ['tokenVersion', 'passwordHash', 'password'])
      expect(profile).not.toHaveProperty(field);
  });
  it('applies OWN identically to list/count/detail and refuses direct writes with 403', async () => {
    const list = await call('get', '/api/products', targetToken)
      .query({ name: prefix, pageSize: 1 })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.list.map((p: { id: string }) => p.id)).toEqual([ownId]);
    await call('get', '/api/products/' + foreignId, targetToken).expect(404);
    await call('get', '/api/products/' + randomUUID(), targetToken).expect(404);
    await call('patch', '/api/products/' + ownId, targetToken)
      .send({ name: 'unauthorized' })
      .expect(403);
    await call('delete', '/api/products/' + ownId, targetToken).expect(403);
    await call('get', '/api/admin/roles', targetToken).expect(403);
  });
  it('version-checks edits and keeps OWN writes while allowing ALL reads', async () => {
    const old = targetToken;
    const r = await call('patch', '/api/admin/roles/' + role.id)
      .send({
        version: role.version,
        grants: [
          { permission: 'product:read', scope: 'ALL' },
          { permission: 'product:update', scope: 'OWN' },
          { permission: 'product:delete', scope: 'OWN' },
        ],
      })
      .expect(200);
    role = r.body;
    await call('patch', '/api/admin/roles/' + role.id)
      .send({ version: 0, name: 'stale' })
      .expect(409);
    await call('get', '/api/products', old).expect(401);
    await login();
    const list = await call('get', '/api/products', targetToken)
      .query({ name: prefix, pageSize: 1 })
      .expect(200);
    expect(list.body.total).toBe(2);
    await call('get', '/api/products/' + foreignId, targetToken).expect(200);
    await call('patch', '/api/products/' + ownId, targetToken)
      .send({ description: 'allowed' })
      .expect(200);
    for (const id of [foreignId, randomUUID()]) {
      const r = await call('patch', '/api/products/' + id, targetToken)
        .send({ description: 'forbidden' })
        .expect(404);
      expect(r.body.message).toBe('商品不存在');
      await call('delete', '/api/products/' + id, targetToken).expect(404);
    }
  });
  it('supports ALL writes, audits snapshots, and disables logins and active credentials', async () => {
    role = (
      await call('patch', '/api/admin/roles/' + role.id)
        .send({
          version: role.version,
          grants: [
            { permission: 'product:read', scope: 'ALL' },
            { permission: 'product:update', scope: 'ALL' },
          ],
        })
        .expect(200)
    ).body;
    await login();
    await call('patch', '/api/products/' + foreignId, targetToken)
      .send({ description: 'all scope' })
      .expect(200);
    await call('delete', '/api/admin/roles/' + role.id).expect(409);
    const audits = await call(
      'get',
      '/api/admin/roles/' + role.id + '/audits',
    ).expect(200);
    expect(
      audits.body.items.some(
        (a: { action: string }) => a.action === 'ASSIGN_USER',
      ),
    ).toBe(true);
    expect(JSON.stringify(audits.body)).not.toContain('passwordHash');
    expect(JSON.stringify(audits.body)).not.toContain('tokenVersion');
    role = (
      await call('patch', '/api/admin/roles/' + role.id)
        .send({ version: role.version, enabled: false })
        .expect(200)
    ).body;
    await call('get', '/api/products', targetToken).expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: prefix + '_target', password })
      .expect(401);
    await call('patch', '/api/admin/users/' + targetId + '/role')
      .send({ roleId: role.id })
      .expect(400);
  });
  it('protects system roles, current role, role IDs and safe deletion', async () => {
    for (const id of [
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
    ])
      await call('delete', '/api/admin/roles/' + id).expect(400);
    await call('patch', '/api/admin/roles/00000000-0000-4000-8000-000000000010')
      .send({ version: 0, name: 'mutated' })
      .expect(400);
    await call('patch', '/api/admin/roles/00000000-0000-4000-8000-000000000011')
      .send({ version: 0, enabled: false })
      .expect(400);
    await call('patch', '/api/admin/users/' + targetId + '/role')
      .send({ roleId: '00000000-0000-4000-8000-000000000011', role: 'ADMIN' })
      .expect(400);
    await call('patch', '/api/admin/users/' + targetId + '/role')
      .send({ roleId: '00000000-0000-4000-8000-000000000011' })
      .expect(200);
    await call('delete', '/api/admin/roles/' + role.id).expect(204);
    const audit = await call(
      'get',
      '/api/admin/roles/' + role.id + '/audits',
    ).expect(200);
    expect(
      audit.body.items.some((a: { action: string }) => a.action === 'DELETE'),
    ).toBe(true);
  });
  it('prevents delegated managers granting superior permissions and editing their own role', async () => {
    const manager = await create('MANAGER', [
      { permission: 'role:read', scope: 'ALL' },
      { permission: 'role:create', scope: 'ALL' },
      { permission: 'role:update', scope: 'ALL' },
      { permission: 'user:read', scope: 'ALL' },
      { permission: 'user:assign-role', scope: 'ALL' },
      { permission: 'product:read', scope: 'OWN' },
    ]);
    await call('patch', '/api/admin/users/' + targetId + '/role')
      .send({ roleId: manager.id })
      .expect(200);
    await login();
    await call('post', '/api/admin/roles', targetToken)
      .send({
        code: prefix.toUpperCase() + '_ESCAPE',
        name: 'escape',
        grants: [{ permission: 'product:read', scope: 'ALL' }],
      })
      .expect(403);
    await call('patch', '/api/admin/roles/' + manager.id, targetToken)
      .send({ version: 0, name: 'self' })
      .expect(400);
    await call('patch', '/api/admin/users/' + adminId + '/role', targetToken)
      .send({ roleId: manager.id })
      .expect(403);
    await call('patch', '/api/admin/users/' + targetId + '/role', targetToken)
      .send({ roleId: '00000000-0000-4000-8000-000000000010' })
      .expect(400);
  });
  it('scopes order list/count/detail and action independently of shared product reads', async () => {
    const scopeRole = await create('ORDERS', [
      { permission: 'order:read', scope: 'OWN' },
      { permission: 'order:confirm', scope: 'OWN' },
      { permission: 'order:create', scope: 'ALL' },
      { permission: 'product:read', scope: 'ALL' },
    ]);
    await call('patch', '/api/admin/users/' + targetId + '/role')
      .send({ roleId: scopeRole.id })
      .expect(200);
    await login();
    const input = (productId: string) => ({
      idempotencyKey: randomUUID(),
      customerName: prefix,
      phone: '13800000000',
      address: '隔离地址',
      items: [{ productId, quantity: 1 }],
    });
    const own = (
      await call('post', '/api/orders', targetToken)
        .send(input(ownId))
        .expect(201)
    ).body;
    const foreign = (
      await call('post', '/api/orders').send(input(foreignId)).expect(201)
    ).body;
    const list = await call('get', '/api/orders', targetToken)
      .query({ search: prefix, pageSize: 1 })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.list[0].id).toBe(own.id);
    for (const id of [foreign.id, randomUUID()]) {
      await call('get', '/api/orders/' + id, targetToken).expect(404);
      await call('patch', '/api/orders/' + id + '/confirm', targetToken)
        .send({})
        .expect(404);
    }
    await call('patch', '/api/orders/' + own.id + '/confirm', targetToken)
      .send({})
      .expect(200);
    await call('patch', '/api/admin/roles/' + scopeRole.id)
      .send({
        version: scopeRole.version,
        grants: [
          { permission: 'order:read', scope: 'ALL' },
          { permission: 'order:confirm', scope: 'OWN' },
        ],
      })
      .expect(200);
    await login();
    const all = await call('get', '/api/orders', targetToken)
      .query({ search: prefix, pageSize: 1 })
      .expect(200);
    expect(all.body.total).toBe(2);
    await call('get', '/api/orders/' + foreign.id, targetToken).expect(200);
    await call('patch', '/api/orders/' + foreign.id + '/confirm', targetToken)
      .send({})
      .expect(404);
  });
  it('publishes role grants, versions, and bearer authentication in OpenAPI', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/docs-json').expect(200)
    ).body;
    expect(doc.paths['/api/admin/roles'].post.security).toEqual([
      { bearer: [] },
    ]);
    expect(doc.components.schemas.UpdateRoleDto.required).toContain('version');
    expect(doc.components.schemas.RoleGrantDto.properties.scope.enum).toEqual([
      'OWN',
      'ALL',
    ]);
  });
});
