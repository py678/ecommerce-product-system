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
import type { UserRole } from '../dist/generated/prisma/client.js';

describe.sequential('RBAC and resource scope HTTP API', () => {
  let app: INestApplication, db: DatabaseService, jwt: JwtService;
  const prefix = 'rbac_' + randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  let categoryId: string, productId: string;
  const ids: string[] = [];
  const previousCompanyId = process.env.ADMIN_REGISTRATION_COMPANY_ID;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    url: string,
    who = 'operator',
  ) => {
    const client = request(app.getHttpServer());
    return client[method](url).set(
      'Authorization',
      'Bearer ' + users[who].token,
    );
  };
  beforeAll(async () => {
    process.env.ADMIN_REGISTRATION_COMPANY_ID = 'registration-company-fixture';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    jwt = app.get(JwtService);
    const passwordHash = await hash('Rbac-test-password-123!', 12);
    for (const [name, role] of Object.entries({
      operator: 'OPERATOR',
      other: 'OPERATOR',
      admin: 'ADMIN',
      second: 'ADMIN',
      target: 'OPERATOR',
    })) {
      const u = await db.user.create({
        data: {
          username: prefix + '_' + name,
          email: prefix + '_' + name + '@example.invalid',
          passwordHash,
          role: role as UserRole,
        },
      });
      ids.push(u.id);
      users[name] = {
        id: u.id,
        token: await jwt.signAsync({ sub: u.id, tokenVersion: 0 }),
      };
    }
    categoryId = (await db.category.create({ data: { name: prefix } })).id;
    for (const name of ['operator', 'other']) {
      const p = await db.product.create({
        data: {
          name: prefix,
          userId: users[name].id,
          categoryId,
          price: '10.00',
          stock: 5,
        },
      });
      if (name === 'operator') productId = p.id;
    }
  });
  afterAll(async () => {
    try {
      if (db) {
        await db.roleAudit.deleteMany({ where: { targetId: { in: ids } } });
        await db.product.deleteMany({ where: { userId: { in: ids } } });
        if (categoryId) await db.category.delete({ where: { id: categoryId } });
        await db.user.deleteMany({ where: { id: { in: ids } } });
      }
    } finally {
      await app?.close();
      if (previousCompanyId === undefined)
        delete process.env.ADMIN_REGISTRATION_COMPANY_ID;
      else process.env.ADMIN_REGISTRATION_COMPANY_ID = previousCompanyId;
    }
  });
  it.each(['operator', 'other', 'admin'])(
    'enforces identical list and count scopes for %s',
    async (who) => {
      const r = await api('get', '/api/products', who)
        .query({ name: prefix, pageSize: 1 })
        .expect(200);
      expect(r.body.total).toBe(2);
      expect(r.body.list).toHaveLength(1);
      expect(r.body.items).toEqual(r.body.list);
      const full = await api('get', '/api/products', who)
        .query({ name: prefix, pageSize: 10 })
        .expect(200);
      expect(
        new Set(full.body.list.map((p: { userId: string }) => p.userId)),
      ).toEqual(new Set(['operator', 'other'].map((name) => users[name].id)));
      await api('get', '/api/products/' + productId, who).expect(200);
      const empty = await api('get', '/api/products', who)
        .query({ name: prefix, minPrice: '11' })
        .expect(200);
      expect(empty.body.total).toBe(0);
      expect(empty.body.list).toEqual([]);
    },
  );
  it('shares reads but hides unauthorized writes and missing products behind identical 404 responses', async () => {
    for (const id of [productId, randomUUID()])
      for (const method of ['patch', 'delete'] as const) {
        const r = await api(method, '/api/products/' + id, 'other')
          .send(method === 'patch' ? { stock: 2, stockVersion: 0 } : undefined)
          .expect(404);
        expect(r.body.message).toBe('商品不存在');
      }
  });
  it.each(['operator', 'admin'])(
    'checks the selected login entrance against the database role for %s',
    async (who) => {
      const user = await db.user.findUniqueOrThrow({
        where: { id: users[who].id },
      });
      const body = {
        username: user.username,
        password: 'Rbac-test-password-123!',
      };
      const match = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ ...body, loginRole: user.role })
        .expect(200);
      expect(match.body.user.role).toBe(user.role);
      expect(match.body.user).not.toHaveProperty('passwordHash');
      const wrongRole = user.role === 'ADMIN' ? 'OPERATOR' : 'ADMIN';
      const mismatch = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ ...body, loginRole: wrongRole })
        .expect(401);
      expect(mismatch.body).not.toHaveProperty('accessToken');
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ ...body, loginRole: 'ROOT' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ ...body, role: 'ADMIN' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          ...body,
          password: 'Wrong-password-123!',
          loginRole: wrongRole,
        })
        .expect(401)
        .expect((r) => expect(r.body.message).toBe('用户名或密码错误'));
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: user.id } })).role,
      ).toBe(user.role);
    },
  );
  it('allows own writes and administrator writes without transferring ownership', async () => {
    await api('patch', '/api/products/' + productId)
      .send({ stock: 6, stockVersion: 0, stockReason: '本人盘点' })
      .expect(200);
    const r = await api('patch', '/api/products/' + productId, 'admin')
      .send({ stock: 7, stockVersion: 1, stockReason: '管理员盘点' })
      .expect(200);
    expect(r.body.userId).toBe(users.operator.id);
    await api('get', '/api/products/' + productId, 'admin').expect(200);
    const created = await api('post', '/api/products', 'admin')
      .send({ name: prefix, categoryId, price: '1' })
      .expect(201);
    expect(created.body.userId).toBe(users.admin.id);
    await api('delete', '/api/products/' + created.body.id, 'admin').expect(
      204,
    );
  });
  it('denies operator access to administrator APIs even when invoked directly', async () => {
    await api('get', '/api/admin/users').expect(403);
    await api('patch', '/api/admin/users/' + users.target.id + '/role')
      .send({ role: 'ADMIN' })
      .expect(403);
  });
  it('shares categories for reads and permits only administrators to maintain them', async () => {
    for (const who of ['operator', 'admin'])
      await api('get', '/api/categories/' + categoryId, who).expect(200);
    for (const who of ['operator']) {
      await api('post', '/api/categories', who)
        .send({ name: prefix })
        .expect(403);
      await api('patch', '/api/categories/' + categoryId, who)
        .send({ name: prefix })
        .expect(403);
      await api('delete', '/api/categories/' + categoryId, who).expect(403);
    }
    await api('patch', '/api/categories/' + categoryId, 'admin')
      .send({ name: prefix })
      .expect(200);
    await api('delete', '/api/categories/' + categoryId, 'admin').expect(409);
  });
  it.each(['creatorId', 'userId', 'role'])(
    'rejects sensitive extra product field %s',
    async (field) => {
      await api('post', '/api/products')
        .send({ name: prefix, categoryId, price: '1', [field]: users.other.id })
        .expect(400);
      await api('patch', '/api/products/' + productId)
        .send({ stock: 2, [field]: 'ADMIN' })
        .expect(400);
      await api('get', '/api/products')
        .query({ [field]: users.other.id })
        .expect(400);
    },
  );
  it('paginates/filter accounts without returning internal fields', async () => {
    const r = await api('get', '/api/admin/users', 'admin')
      .query({ search: prefix, role: 'OPERATOR', pageSize: 1 })
      .expect(200);
    expect(r.body.total).toBe(3);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).not.toHaveProperty('passwordHash');
    expect(r.body.items[0]).not.toHaveProperty('tokenVersion');
    await api('get', '/api/admin/users', 'admin')
      .query({ role: 'ROOT' })
      .expect(200)
      .expect((r) => expect(r.body.total).toBe(0));
    await api('patch', '/api/admin/users/' + users.target.id + '/role', 'admin')
      .send({ role: 'ADMIN', tokenVersion: 99 })
      .expect(400);
  });
  it('atomically changes role, records audit and revokes every old token', async () => {
    const secondToken = await jwt.signAsync({
      sub: users.target.id,
      tokenVersion: 0,
    });
    await api('patch', '/api/admin/users/' + users.target.id + '/role', 'admin')
      .send({ role: 'ADMIN' })
      .expect(200);
    const user = await db.user.findUniqueOrThrow({
      where: { id: users.target.id },
    });
    expect(user.role).toBe('ADMIN');
    expect(user.tokenVersion).toBe(1);
    expect(
      await db.roleAudit.count({
        where: {
          actorId: users.admin.id,
          targetId: user.id,
          fromRole: 'OPERATOR',
          toRole: 'ADMIN',
        },
      }),
    ).toBe(1);
    for (const token of [users.target.token, secondToken])
      for (const path of [
        '/api/auth/me',
        '/api/users/me',
        '/api/products',
        '/api/categories',
      ])
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer ' + token)
          .expect(401);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: user.username, password: 'Rbac-test-password-123!' })
      .expect(200);
    expect(login.body.user.role).toBe('ADMIN');
    expect(login.body.user.permissions).toContain('user:read');
    await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', 'Bearer ' + login.body.accessToken)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', 'Bearer ' + login.body.accessToken)
      .send({})
      .expect(400);
  });
  it('rolls back both role and version when the audit insert fails', async () => {
    // The isolated test schema is the only target; UUID is generated by the fixture.
    await db.$executeRawUnsafe(
      `ALTER TABLE role_audits ADD CONSTRAINT rbac_audit_fixture CHECK (target_id <> '${users.other.id}'::uuid)`,
    );
    try {
      await api(
        'patch',
        '/api/admin/users/' + users.other.id + '/role',
        'admin',
      )
        .send({ role: 'ADMIN' })
        .expect(500);
      const user = await db.user.findUniqueOrThrow({
        where: { id: users.other.id },
      });
      expect(user.role).toBe('OPERATOR');
      expect(user.tokenVersion).toBe(0);
      await api('get', '/api/auth/me', 'other').expect(200);
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE role_audits DROP CONSTRAINT rbac_audit_fixture',
      );
    }
  });
  it('forbids self role changes and rejects unknown role values', async () => {
    await api('patch', '/api/admin/users/' + users.admin.id + '/role', 'admin')
      .send({ role: 'OPERATOR' })
      .expect(400);
    await api('patch', '/api/admin/users/' + users.target.id + '/role', 'admin')
      .send({ role: 'ROOT' })
      .expect(400);
    await api('patch', '/api/admin/users/' + randomUUID() + '/role', 'admin')
      .send({ role: 'ADMIN' })
      .expect(404);
  });
  it('registers operators by default and rejects unauthorized administrator registration', async () => {
    const body = {
      username: prefix + '_registered',
      email: prefix + '_registered@example.invalid',
      password: 'Rbac-register-123!',
    };
    for (const extra of [
      { role: 'ADMIN' },
      { role: 'ADMIN', companyId: 'wrong-company' },
      { creatorId: users.admin.id },
      { role: 'ROOT' },
    ])
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...body, ...extra })
        .expect(400);
    expect(
      await db.user.findUnique({ where: { username: body.username } }),
    ).toBeNull();
    const r = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body)
      .expect(201);
    ids.push(r.body.user.id);
    expect(r.body.user.role).toBe('OPERATOR');
    expect(r.body.user.permissions).toContain('product:create');
    expect(r.body.user).not.toHaveProperty('tokenVersion');
    expect(r.body).not.toHaveProperty('companyId');
  });
  it('registers an administrator only with the server-configured company identifier', async () => {
    const previous = process.env.ADMIN_REGISTRATION_COMPANY_ID;
    process.env.ADMIN_REGISTRATION_COMPANY_ID = 'registration-company-fixture';
    const body = {
      username: prefix + '_admin_registered',
      email: prefix + '_admin_registered@example.invalid',
      password: 'Rbac-register-123!',
      role: 'ADMIN',
    };
    try {
      const r = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...body, companyId: 'registration-company-fixture' })
        .expect(201);
      ids.push(r.body.user.id);
      expect(r.body.user.role).toBe('ADMIN');
      expect(r.body.user.permissions).toContain('user:read');
      expect(JSON.stringify(r.body)).not.toContain(
        'registration-company-fixture',
      );
      delete process.env.ADMIN_REGISTRATION_COMPANY_ID;
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          ...body,
          username: prefix + '_disabled',
          companyId: 'registration-company-fixture',
        })
        .expect(503);
      expect(
        await db.user.count({ where: { username: prefix + '_disabled' } }),
      ).toBe(0);
    } finally {
      if (previous === undefined)
        delete process.env.ADMIN_REGISTRATION_COMPANY_ID;
      else process.env.ADMIN_REGISTRATION_COMPANY_ID = previous;
    }
  });
  it('does not trust JWT role claims over the database', async () => {
    const token = await jwt.signAsync({
      sub: users.operator.id,
      tokenVersion: 0,
      role: 'ADMIN',
    });
    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', 'Bearer ' + token)
      .expect(403);
  });
  it('publishes role enums, guarded admin operations and 403/404 contracts', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/docs-json').expect(200)
    ).body;
    expect(doc.components.schemas.UserResponseDto.properties.role.type).toBe(
      'string',
    );
    expect(
      doc.components.schemas.UserResponseDto.properties.roleId.format,
    ).toBe('uuid');
    expect(doc.components.schemas.LoginDto.properties.loginRole.enum).toEqual([
      'OPERATOR',
      'ADMIN',
    ]);
    expect(doc.components.schemas.LoginDto.required).not.toContain('loginRole');
    expect(doc.components.schemas.AssignRoleDto.properties.roleId.format).toBe(
      'uuid',
    );
    expect(
      doc.components.schemas.AssignRoleDto.properties.role.deprecated,
    ).toBe(true);
    for (const [path, method] of [
      ['/api/admin/users', 'get'],
      ['/api/admin/users/{id}/role', 'patch'],
    ]) {
      expect(doc.paths[path][method].security).toEqual([{ bearer: [] }]);
      expect(doc.paths[path][method].responses['403']).toBeDefined();
    }
    expect(
      doc.paths['/api/products/{id}'].patch.responses['404'],
    ).toBeDefined();
  });
});
