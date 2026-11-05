import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { OrdersService } from '../dist/orders/orders.service.js';

describe.sequential('Orders transactional HTTP (isolated PostgreSQL)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  const prefix = 'orders_' + randomUUID().slice(0, 8);
  const users: string[] = [];
  const tokens: string[] = [];
  let categoryId: string;
  const products: string[] = [];
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
    who = 0,
  ) => {
    const client = request(app.getHttpServer());
    return client[method]('/api' + path)
      .set('Authorization', 'Bearer ' + tokens[who])
      .send(body);
  };
  const input = (id = products[0], quantity = 1) => ({
    idempotencyKey: randomUUID(),
    customerName: '测试客户',
    phone: '13800000000',
    address: '测试收货地址',
    items: [{ productId: id, quantity }],
  });
  async function item(stock = 10) {
    const p = await db.product.create({
      data: {
        name: prefix + '商品',
        price: '12.35',
        stock,
        userId: users[1],
        categoryId,
      },
    });
    products.push(p.id);
    return p;
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
    expect(app.get(OrdersService)).toBeDefined();
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
      tokens.push(
        await app.get(JwtService).signAsync({ sub: u.id, tokenVersion: 0 }),
      );
    }
    categoryId = (await db.category.create({ data: { name: prefix } })).id;
    await item();
  });
  afterAll(async () => {
    if (db) {
      await db.order.deleteMany({ where: { creatorId: { in: users } } });
      await db.product.deleteMany({ where: { id: { in: products } } });
      await db.category.deleteMany({ where: { id: categoryId } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    }
    if (app) await app.close();
  });
  it('Swagger matches order contracts and enforces empty-body actions', async () => {
    const doc = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(
      doc.body.paths['/api/orders'].get.parameters.map(
        (p: { name: string }) => p.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'page',
        'pageSize',
        'search',
        'status',
        'createdFrom',
        'createdTo',
      ]),
    );
    expect(doc.body.components.schemas.CreateOrderDto.required).toContain(
      'idempotencyKey',
    );
    expect(doc.body.components.schemas.ShipOrderDto.required).toEqual(
      expect.arrayContaining(['carrier', 'trackingNo']),
    );
    const a = await call('post', '/orders', input()).expect(201);
    await call('patch', '/orders/' + a.body.id + '/confirm', {
      creatorId: users[1],
    }).expect(400);
    await call('patch', '/orders/' + a.body.id + '/confirm', {}).expect(200);
    await call('patch', '/orders/' + a.body.id + '/ship', {
      carrier: '',
      trackingNo: 'x',
    }).expect(400);
  });
  it('validates whitelist, nested items, enum and pagination', async () => {
    for (const extra of [
      { creatorId: randomUUID() },
      { role: 'ADMIN' },
      { status: 'SHIPPED' },
      { totalAmount: '0' },
    ])
      await call('post', '/orders', { ...input(), ...extra }).expect(400);
    for (const q of [
      'pageSize=101',
      'page=0',
      'status=wrong',
      'createdFrom=bad',
      'createdFrom=2026-11-10T00:00:00Z&createdTo=2026-11-01T00:00:00Z',
    ])
      await call('get', '/orders?' + q).expect(400);
    await call('post', '/orders', {
      ...input(),
      items: [{ productId: products[0], quantity: 0 }],
    }).expect(400);
    await call('post', '/orders', {
      ...input(),
      items: [{ productId: products[0], quantity: 1, price: '0' }],
    }).expect(400);
    const body = input();
    await call('post', '/orders', {
      ...body,
      items: [...body.items, ...body.items],
    }).expect(400);
  });
  it('computes immutable Decimal snapshots; same-key concurrent retry decrements once', async () => {
    const p = await item(10);
    const body = input(p.id, 2);
    const [a, b] = await Promise.all([
      call('post', '/orders', body),
      call('post', '/orders', body),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    const canonical = await call('post', '/orders', {
      ...body,
      idempotencyKey: body.idempotencyKey.toUpperCase(),
      items: body.items.map((i) => ({
        quantity: i.quantity,
        productId: i.productId.toUpperCase(),
      })),
    }).expect(201);
    expect(canonical.body.id).toBe(a.body.id);
    expect(a.body.totalAmount).toBe('24.70');
    expect(a.body.items[0]).toMatchObject({
      unitPrice: '12.35',
      subtotal: '24.70',
      quantity: 2,
    });
    expect(await db.product.findUnique({ where: { id: p.id } })).toMatchObject({
      stock: 8,
      stockVersion: 1,
    });
    expect(a.body).not.toHaveProperty('requestHash');
    expect(a.body).not.toHaveProperty('idempotencyKey');
    await call('post', '/orders', { ...body, address: '不同地址' }).expect(409);
    await db.product.update({
      where: { id: p.id },
      data: { name: '改名', price: '99' },
    });
    const detail = await call('get', '/orders/' + a.body.id).expect(200);
    expect(detail.body.items[0].productName).toBe(p.name);
  });
  it('concurrent competition cannot oversell and shortage rolls back every item/log', async () => {
    const p = await item(1);
    const responses = await Promise.all([
      call('post', '/orders', input(p.id)),
      call('post', '/orders', input(p.id)),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const q = await item(9);
    const body = input();
    body.items = [
      { productId: q.id, quantity: 2 },
      { productId: p.id, quantity: 1 },
    ];
    await call('post', '/orders', body).expect(409);
    expect((await db.product.findUnique({ where: { id: q.id } }))?.stock).toBe(
      9,
    );
    expect(
      await db.order.count({ where: { idempotencyKey: body.idempotencyKey } }),
    ).toBe(0);
  });
  it('scopes list/count/detail/actions identically; allows admin confirmation and global product ordering', async () => {
    const a = await call('post', '/orders', input()).expect(201);
    const list = await call('get', '/orders').expect(200);
    expect(list.body.total).toBe(list.body.list.length);
    expect(
      list.body.list.every(
        (o: { creatorId: string }) => o.creatorId === users[0],
      ),
    ).toBe(true);
    for (const path of ['/orders/' + a.body.id, '/orders/' + randomUUID()])
      await call('get', path, undefined, 1).expect(404);
    await call('patch', '/orders/' + a.body.id + '/confirm', {}, 1).expect(404);
    await call('patch', '/orders/' + a.body.id + '/confirm', {}, 2).expect(200);
    await call('patch', '/orders/' + a.body.id + '/ship', {
      carrier: '物流',
      trackingNo: 'TEST001',
    }).expect(200);
    const before = (await db.product.findUnique({
      where: { id: products[0] },
    }))!.stock;
    await call(
      'patch',
      '/orders/' + a.body.id + '/cancel',
      { reason: '不允许' },
      2,
    ).expect(409);
    await call('patch', '/orders/' + a.body.id + '/complete', {}).expect(200);
    await call('patch', '/orders/' + a.body.id + '/cancel', {
      reason: '不允许',
    }).expect(409);
    expect(
      (await db.product.findUnique({ where: { id: products[0] } }))!.stock,
    ).toBe(before);
  });
  it('concurrent cancellation restores stock once, logs only committed transitions', async () => {
    const p = await item(4);
    const a = await call('post', '/orders', input(p.id, 2)).expect(201);
    const rs = await Promise.all([
      call('patch', '/orders/' + a.body.id + '/cancel', { reason: '录错' }),
      call('patch', '/orders/' + a.body.id + '/cancel', { reason: '录错' }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.product.findUnique({ where: { id: p.id } }))!.stock).toBe(
      4,
    );
    expect(await db.orderLog.count({ where: { orderId: a.body.id } })).toBe(2);
  });
  it('cancel/ship race has one winner and correct stock', async () => {
    const p = await item(5);
    const a = await call('post', '/orders', input(p.id, 2)).expect(201);
    await call('patch', '/orders/' + a.body.id + '/confirm', {}).expect(200);
    const rs = await Promise.all([
      call('patch', '/orders/' + a.body.id + '/cancel', { reason: '取消' }),
      call('patch', '/orders/' + a.body.id + '/ship', {
        carrier: '物流',
        trackingNo: 'RACE',
      }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const order = await db.order.findUnique({ where: { id: a.body.id } });
    expect((await db.product.findUnique({ where: { id: p.id } }))!.stock).toBe(
      order!.status === 'CANCELLED' ? 5 : 3,
    );
  });
  it('rejects stale manual stock writes and deletion of referenced products', async () => {
    const p = await item(7);
    await call('post', '/orders', input(p.id)).expect(201);
    await call(
      'patch',
      '/products/' + p.id,
      { stock: 99, stockVersion: 0 },
      1,
    ).expect(409);
    await call('patch', '/products/' + p.id, { stock: 99 }, 1).expect(400);
    await call('delete', '/products/' + p.id, undefined, 1).expect(409);
  });
});
