import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { DatabaseService } from '../dist/database/database.service.js';

// Only run through the verification runner's random PostgreSQL schema.
describe.sequential('Product publication transactional HTTP', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let categoryId: string;
  const users: string[] = [];
  const roles: string[] = [];
  const tokens: string[] = [];
  const products: string[] = [];
  const prefix = 'publish_' + randomUUID().slice(0, 8);
  const call = (
    method: 'get' | 'post' | 'patch',
    path: string,
    body?: object,
    who = 0,
  ) => {
    const client = request(app.getHttpServer());
    return client[method]('/api' + path)
      .set('Authorization', 'Bearer ' + tokens[who])
      .send(body);
  };
  const input = (productId: string) => ({
    idempotencyKey: randomUUID(),
    customerName: '上下架测试客户',
    phone: '13800000000',
    address: '测试收货地址',
    items: [{ productId, quantity: 2 }],
  });
  const status = (id: string, value = 'OFFLINE', who = 0) =>
    call('patch', `/products/${id}/status`, { status: value }, who);
  async function item() {
    const result = await call('post', '/products', {
      name: prefix + randomUUID().slice(0, 8),
      price: '12.35',
      stock: 10,
      categoryId,
    }).expect(201);
    products.push(result.body.id);
    return result.body as {
      id: string;
      stock: number;
      stockVersion: number;
      status: string;
    };
  }
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    for (const [i, role] of ['OPERATOR', 'OPERATOR', 'ADMIN'].entries()) {
      const u = await db.user.create({
        data: {
          username: prefix + i,
          email: prefix + i + '@example.invalid',
          passwordHash: 'test-only',
          role: role as 'ADMIN' | 'OPERATOR',
        },
      });
      users.push(u.id);
    }
    // Custom scopes prove authorization uses grants rather than a role name.
    for (const [i, writable] of [false, true].entries()) {
      const r = await db.role.create({
        data: {
          code: prefix.toUpperCase() + i,
          name: prefix + i,
          grants: {
            create: [
              { permissionCode: 'product:read', scope: 'ALL' },
              ...(writable
                ? [{ permissionCode: 'product:update', scope: 'ALL' as const }]
                : []),
            ],
          },
        },
      });
      roles.push(r.id);
      const u = await db.user.create({
        data: {
          username: prefix + 'custom' + i,
          email: prefix + 'custom' + i + '@example.invalid',
          passwordHash: 'test-only',
          roleId: r.id,
        },
      });
      users.push(u.id);
    }
    for (const id of users)
      tokens.push(
        await app.get(JwtService).signAsync({ sub: id, tokenVersion: 0 }),
      );
    categoryId = (await db.category.create({ data: { name: prefix } })).id;
  });
  afterAll(async () => {
    if (db) {
      await db.orderLog.deleteMany({
        where: { order: { creatorId: { in: users } } },
      });
      await db.orderItem.deleteMany({
        where: { order: { creatorId: { in: users } } },
      });
      await db.order.deleteMany({ where: { creatorId: { in: users } } });
      await db.product.deleteMany({ where: { id: { in: products } } });
      if (categoryId)
        await db.category.deleteMany({ where: { id: categoryId } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.role.deleteMany({ where: { id: { in: roles } } });
    }
    if (app) await app.close();
  });
  it('defaults published and scopes status writes without changing stock or movements', async () => {
    const p = await item();
    expect(p.status).toBe('PUBLISHED');
    await request(app.getHttpServer())
      .patch(`/api/products/${p.id}/status`)
      .send({ status: 'OFFLINE' })
      .expect(401);
    const foreign = await status(p.id, 'OFFLINE', 1).expect(404);
    const missing = await status(randomUUID(), 'OFFLINE', 1).expect(404);
    expect(foreign.body.message).toEqual(missing.body.message);
    await status(p.id, 'OFFLINE', 3).expect(403);
    const before = await db.stockMovement.count({ where: { productId: p.id } });
    const changed = await status(p.id).expect(200);
    expect(changed.body).toMatchObject({
      status: 'OFFLINE',
      stock: p.stock,
      stockVersion: p.stockVersion,
    });
    const repeated = await status(p.id).expect(200);
    expect(repeated.body.updatedAt).toBe(changed.body.updatedAt);
    await status(p.id, 'PUBLISHED', 2).expect(200);
    await status(p.id, 'OFFLINE', 4).expect(200);
    const detail = await call('get', `/products/${p.id}`, undefined, 1).expect(
      200,
    );
    expect(detail.body).toMatchObject({
      status: 'OFFLINE',
      stock: p.stock,
      stockVersion: p.stockVersion,
    });
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
      before,
    );
  });
  it('rejects invalid status and unauthorized contract fields and preserves ordinary edits', async () => {
    const p = await item();
    for (const body of [
      {},
      { status: null },
      { status: 'offline' },
      { status: 'DRAFT' },
      { status: ['OFFLINE'] },
      { status: 'OFFLINE', userId: users[1] },
      { status: 'OFFLINE', role: 'ADMIN' },
      { status: 'OFFLINE', stock: 0 },
    ])
      await call('patch', `/products/${p.id}/status`, body).expect(400);
    await call('patch', `/products/${p.id}`, { status: 'OFFLINE' }).expect(400);
    await call('post', '/products', {
      name: prefix,
      price: '1.00',
      categoryId,
      status: 'OFFLINE',
    }).expect(400);
    await status(p.id).expect(200);
    const edited = await call('patch', `/products/${p.id}`, {
      name: prefix + 'edited',
    }).expect(200);
    expect(edited.body.status).toBe('OFFLINE');
    for (const query of [
      'status=wrong',
      'status=',
      'status=OFFLINE&status=PUBLISHED',
    ])
      await call('get', '/products?' + query).expect(400);
  });
  it('combines status with filters and keeps pagination totals consistent', async () => {
    const fixtures = await Promise.all([item(), item(), item()]);
    for (const p of fixtures.slice(0, 2)) await status(p.id).expect(200);
    const q = `categoryId=${categoryId}&name=${prefix}&status=OFFLINE&pageSize=1&sortBy=price&sortOrder=asc`;
    const first = await call('get', '/products?' + q).expect(200);
    const second = await call('get', '/products?' + q + '&page=2').expect(200);
    const actual = await db.product.count({
      where: { categoryId, status: 'OFFLINE' },
    });
    expect(first.body.total).toBe(actual);
    expect(second.body.total).toBe(actual);
    expect(first.body.list).toHaveLength(1);
    expect(second.body.list).toHaveLength(1);
    expect(first.body.list[0].status).toBe('OFFLINE');
    expect(first.body.list[0].id).not.toBe(second.body.list[0].id);
    const published = await call(
      'get',
      `/products?categoryId=${categoryId}&status=PUBLISHED`,
    ).expect(200);
    expect(
      published.body.list.every(
        (p: { status: string }) => p.status === 'PUBLISHED',
      ),
    ).toBe(true);
  });
  it('rejects an entire mixed order and preserves successful idempotency and cancellation offline', async () => {
    const a = await item(),
      b = await item();
    const body = input(a.id);
    const original = await call('post', '/orders', body).expect(201);
    await status(a.id).expect(200);
    const retry = await call('post', '/orders', body).expect(201);
    expect(retry.body).toEqual(original.body);
    const counts = await Promise.all([
      db.order.count(),
      db.stockMovement.count(),
    ]);
    const before = await db.product.findMany({
      where: { id: { in: [a.id, b.id] } },
    });
    await call('post', '/orders', {
      ...input(b.id),
      items: [
        { productId: b.id, quantity: 2 },
        { productId: a.id, quantity: 2 },
      ],
    }).expect(409);
    expect(
      await Promise.all([db.order.count(), db.stockMovement.count()]),
    ).toEqual(counts);
    expect(
      await db.product.findMany({ where: { id: { in: [a.id, b.id] } } }),
    ).toEqual(before);
    await call('patch', `/orders/${original.body.id}/confirm`, {}).expect(200);
    await call('patch', `/orders/${original.body.id}/cancel`, {
      reason: '测试',
    }).expect(200);
    const after = await call('get', `/products/${a.id}`).expect(200);
    expect(after.body).toMatchObject({ status: 'OFFLINE', stock: 10 });
    await call('patch', `/orders/${original.body.id}/cancel`, {
      reason: '重复',
    }).expect(409);
  });
  it('allows existing orders to ship and complete after publication changes', async () => {
    const p = await item();
    const order = await call('post', '/orders', input(p.id)).expect(201);
    await status(p.id).expect(200);
    for (const [action, body] of [
      ['confirm', {}],
      ['ship', { carrier: '测试物流', trackingNo: 'TEST123' }],
      ['complete', {}],
    ] as const)
      await call('patch', `/orders/${order.body.id}/${action}`, body).expect(
        200,
      );
    expect(
      (await call('get', `/products/${p.id}`).expect(200)).body.stock,
    ).toBe(8);
  });
  async function waitForLocks(holderPid: number, count: number) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const rows = await db.$queryRaw<{ count: number }[]>`
        WITH RECURSIVE blocked(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid))
          UNION
          SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
        ) SELECT count(*)::int AS count FROM blocked
      `;
      if (rows[0].count >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      'Product requests did not contend on the expected row lock',
    );
  }
  it.each([true, false])(
    'serializes status and ordering on the same row, status first=%s',
    async (statusFirst) => {
      const p = await item();
      let publication!: Promise<request.Response>,
        order!: Promise<request.Response>;
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM products WHERE id=${p.id}::uuid FOR UPDATE`;
          const [{ pid }] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          const publish = () => {
            publication = status(p.id).then((r) => r);
          };
          const reserve = () => {
            order = call('post', '/orders', input(p.id)).then((r) => r);
          };
          (statusFirst ? publish : reserve)();
          await waitForLocks(pid, 1);
          (statusFirst ? reserve : publish)();
          await waitForLocks(pid, 2);
        },
        { timeout: 15000 },
      );
      const [changed, created] = await Promise.all([publication, order]);
      expect(changed.status).toBe(200);
      expect(created.status).toBe(statusFirst ? 409 : 201);
      const current = await call('get', `/products/${p.id}`).expect(200);
      expect(current.body).toMatchObject({
        status: 'OFFLINE',
        stock: statusFirst ? 10 : 8,
      });
      expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
        statusFirst ? 1 : 2,
      );
    },
  );
  it('documents strict status contracts, scopes and responses in Swagger', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/docs-json').expect(200)
    ).body;
    const operation = doc.paths['/api/products/{id}/status'].patch;
    expect(operation.security).toEqual(
      expect.arrayContaining([{ bearer: [] }]),
    );
    expect(operation['x-permissions']).toEqual(['product:update']);
    for (const code of ['200', '400', '401', '403', '404', '503'])
      expect(operation.responses).toHaveProperty(code);
    const schemas = doc.components.schemas;
    expect(schemas.UpdateProductStatusDto.required).toEqual(['status']);
    expect(schemas.UpdateProductStatusDto.properties.status.enum).toEqual([
      'PUBLISHED',
      'OFFLINE',
    ]);
    expect(schemas.ProductResponseDto.required).toContain('status');
    expect(schemas.ProductResponseDto.properties.status.enum).toEqual([
      'PUBLISHED',
      'OFFLINE',
    ]);
    expect(schemas.CreateProductDto.properties).not.toHaveProperty('status');
    expect(schemas.UpdateProductDto.properties).not.toHaveProperty('status');
    expect(doc.paths['/api/products'].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          required: false,
          schema: expect.objectContaining({ enum: ['PUBLISHED', 'OFFLINE'] }),
        }),
      ]),
    );
  });
});
