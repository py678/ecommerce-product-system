import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { DatabaseService } from '../dist/database/database.service.js';

describe.sequential('Stock movement transactional HTTP', () => {
  let app: INestApplication;
  let db: DatabaseService;
  const users: string[] = [];
  const tokens: string[] = [];
  const products: string[] = [];
  let categoryId: string;
  const prefix = 'stock_' + randomUUID().slice(0, 8);
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
  async function item(stock: number) {
    const p = (
      await call('post', '/products', {
        name: prefix + randomUUID().slice(0, 8),
        price: '1.00',
        stock,
        categoryId,
      }).expect(201)
    ).body as { id: string; name: string; stock: number; stockVersion: number };
    products.push(p.id);
    return p;
  }
  const orderInput = (productId: string, quantity = 1) => ({
    idempotencyKey: randomUUID(),
    customerName: '事务测试客户',
    phone: '13800000000',
    address: '事务测试地址',
    items: [{ productId, quantity }],
  });
  async function reserveNextVersion(p: {
    id: string;
    name: string;
    stock: number;
    stockVersion: number;
  }) {
    // A conflicting append in an isolated fixture injects a real database write failure.
    await db.stockMovement.create({
      data: {
        productId: p.id,
        productName: p.name,
        ownerId: users[0],
        type: 'INITIAL',
        beforeStock: 0,
        quantityChange: p.stock,
        afterStock: p.stock,
        stockVersion: p.stockVersion + 1,
        reason: 'isolated failure fixture',
        operationKey: randomUUID(),
      },
    });
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
      tokens.push(
        await app.get(JwtService).signAsync({ sub: u.id, tokenVersion: 0 }),
      );
    }
    categoryId = (await db.category.create({ data: { name: prefix } })).id;
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
  it('records initial zero and only real adjustments; rejects missing reason and stale versions', async () => {
    const created = await call('post', '/products', {
      name: prefix,
      price: '12.00',
      stock: 0,
      categoryId,
    }).expect(201);
    const p = created.body;
    products.push(p.id);
    const initial = await call(
      'get',
      `/products/${p.id}/stock-movements`,
    ).expect(200);
    expect(initial.body.list).toHaveLength(1);
    expect(initial.body.list[0]).toMatchObject({
      type: 'INITIAL',
      beforeStock: 0,
      afterStock: 0,
      quantityChange: 0,
    });
    expect(initial.body.list[0]).not.toHaveProperty('ownerId');
    expect(initial.body.list[0]).not.toHaveProperty('operationKey');
    await call('patch', `/products/${p.id}`, {
      stock: 3,
      stockVersion: p.stockVersion,
    }).expect(400);
    const changed = await call('patch', `/products/${p.id}`, {
      stock: 3,
      stockVersion: p.stockVersion,
      stockReason: '  盘点  ',
    }).expect(200);
    await call('patch', `/products/${p.id}`, {
      stock: 4,
      stockVersion: p.stockVersion,
      stockReason: '过期',
    }).expect(409);
    await call('patch', `/products/${p.id}`, {
      stock: 3,
      stockVersion: changed.body.stockVersion,
    }).expect(200);
    const movements = await call(
      'get',
      `/products/${p.id}/stock-movements`,
    ).expect(200);
    expect(movements.body.total).toBe(2);
    expect(movements.body.list[0]).toMatchObject({
      type: 'ADJUSTMENT',
      beforeStock: 0,
      quantityChange: 3,
      afterStock: 3,
      reason: '盘点',
      stockVersion: changed.body.stockVersion,
    });
    await call('get', `/products/${p.id}/stock-movements`, undefined, 1).expect(
      404,
    );
    await call('get', `/products/${p.id}/stock-movements`, undefined, 2).expect(
      200,
    );
    await call('get', '/stock-movements?ownerId=' + users[0]).expect(400);
  });
  it('deducts and restores once, intersects order and stock scopes, and exposes no customer data', async () => {
    const created = await call('post', '/products', {
      name: prefix + 'order',
      price: '12.00',
      stock: 5,
      categoryId,
    }).expect(201);
    const p = created.body;
    products.push(p.id);
    const body = {
      idempotencyKey: randomUUID(),
      customerName: '私密客户',
      phone: '13800000000',
      address: '私密地址',
      items: [{ productId: p.id, quantity: 2 }],
    };
    const order = (await call('post', '/orders', body, 1).expect(201)).body;
    await call('post', '/orders', body, 1).expect(201);
    await call('get', `/orders/${order.id}/stock-movements`).expect(404);
    const invisible = await call(
      'get',
      `/orders/${order.id}/stock-movements`,
      undefined,
      1,
    ).expect(200);
    expect(invisible.body.total).toBe(0);
    await call(
      'patch',
      `/orders/${order.id}/cancel`,
      { reason: '私密取消客户信息标记' },
      1,
    ).expect(200);
    await call(
      'patch',
      `/orders/${order.id}/cancel`,
      { reason: '重复' },
      1,
    ).expect(409);
    const ledger = await call(
      'get',
      `/orders/${order.id}/stock-movements`,
      undefined,
      2,
    ).expect(200);
    expect(ledger.body.total).toBe(2);
    expect(ledger.body.list.map((m: { type: string }) => m.type)).toEqual([
      'ORDER_CANCEL',
      'ORDER_DEDUCT',
    ]);
    expect(JSON.stringify(ledger.body)).not.toContain('私密');
    const orderDetail = await call(
      'get',
      `/orders/${order.id}`,
      undefined,
      1,
    ).expect(200);
    expect(orderDetail.body.logs).toContainEqual(
      expect.objectContaining({
        action: 'cancel',
        reason: '私密取消客户信息标记',
      }),
    );
    expect(
      (await call('get', `/products/${p.id}`).expect(200)).body.stock,
    ).toBe(5);
    const docs = (
      await request(app.getHttpServer()).get('/docs-json').expect(200)
    ).body;
    expect(docs.paths['/api/stock-movements'].get['x-permissions']).toEqual([
      'stock:read',
    ]);
    expect(
      docs.paths['/api/orders/{id}/stock-movements'].get['x-permissions'],
    ).toEqual(['stock:read', 'order:read']);
    expect(
      ledger.body.list.every((m: { canViewOrder: boolean }) => m.canViewOrder),
    ).toBe(true);
    const productLedger = await call(
      'get',
      `/products/${p.id}/stock-movements`,
    ).expect(200);
    expect(
      productLedger.body.list.every(
        (m: { canViewOrder: boolean }) => !m.canViewOrder,
      ),
    ).toBe(true);
    expect(JSON.stringify(productLedger.body)).not.toContain(
      '私密取消客户信息标记',
    );
  });
  it('rolls back stock when appending the movement fails', async () => {
    const p = (
      await call('post', '/products', {
        name: prefix + 'failure',
        price: '1.00',
        stock: 2,
        categoryId,
      }).expect(201)
    ).body;
    products.push(p.id);
    // Reserve the next version in this isolated fixture to force the ledger unique constraint.
    await db.stockMovement.create({
      data: {
        productId: p.id,
        productName: p.name,
        ownerId: users[0],
        type: 'INITIAL',
        beforeStock: 0,
        quantityChange: 2,
        afterStock: 2,
        stockVersion: p.stockVersion + 1,
        reason: 'isolated failure fixture',
        operationKey: randomUUID(),
      },
    });
    await call('patch', `/products/${p.id}`, {
      stock: 4,
      stockVersion: p.stockVersion,
      stockReason: '失败应回滚',
    }).expect(500);
    const after = (await call('get', `/products/${p.id}`).expect(200)).body;
    expect(after.stock).toBe(2);
    expect(after.stockVersion).toBe(p.stockVersion);
    expect(
      await db.stockMovement.count({
        where: { productId: p.id, type: 'ADJUSTMENT' },
      }),
    ).toBe(0);
  });
  it('rejects missing permissions and invalid filters; preserves snapshots after product deletion', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: users[1] } });
    const role = await db.role.create({
      data: { code: prefix.toUpperCase(), name: prefix },
    });
    try {
      await db.user.update({
        where: { id: user.id },
        data: { roleId: role.id },
      });
      await call('get', '/stock-movements', undefined, 1).expect(403);
    } finally {
      await db.user.update({
        where: { id: user.id },
        data: { roleId: user.roleId },
      });
      await db.role.delete({ where: { id: role.id } });
    }
    await request(app.getHttpServer()).get('/api/stock-movements').expect(401);
    for (const query of [
      'pageSize=101',
      'type=UNKNOWN',
      'createdFrom=invalid',
      'createdFrom=2026-02-02&createdTo=2026-01-01',
    ])
      await call('get', '/stock-movements?' + query).expect(400);
    const p = (
      await call('post', '/products', {
        name: prefix + 'snapshot',
        price: '1.00',
        stock: 1,
        categoryId,
      }).expect(201)
    ).body;
    products.push(p.id);
    await call('patch', `/products/${p.id}`, { name: '改名后的商品' }).expect(
      200,
    );
    await request(app.getHttpServer())
      .delete('/api/products/' + p.id)
      .set('Authorization', 'Bearer ' + tokens[0])
      .expect(204);
    const ledger = await call(
      'get',
      `/stock-movements?productId=${p.id}&pageSize=1`,
    ).expect(200);
    expect(ledger.body.total).toBe(1);
    expect(ledger.body.list[0]).toMatchObject({
      productName: p.name,
      actorName: prefix + '0',
      canViewOrder: false,
    });
    await call('get', `/products/${p.id}/stock-movements`).expect(404);
  });
  it('serializes two orders competing for the last unit and records exactly one deduction', async () => {
    const p = await item(1);
    const inputs = [orderInput(p.id), orderInput(p.id)];
    const attempts = await Promise.all(
      inputs.map((body) => call('post', '/orders', body)),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    const current = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(current).toMatchObject({
      stock: 0,
      stockVersion: p.stockVersion + 1,
    });
    const movements = await db.stockMovement.findMany({
      where: { productId: p.id },
      orderBy: { stockVersion: 'asc' },
    });
    expect(movements).toHaveLength(2);
    expect(movements[1]).toMatchObject({
      type: 'ORDER_DEDUCT',
      beforeStock: movements[0].afterStock,
      quantityChange: -1,
      afterStock: 0,
      stockVersion: movements[0].stockVersion + 1,
    });
    expect(
      await db.order.count({
        where: { idempotencyKey: { in: inputs.map((i) => i.idempotencyKey) } },
      }),
    ).toBe(1);
  });
  it('rolls back every product and leaves no order or deduction when one item is short', async () => {
    const available = await item(5);
    const empty = await item(0);
    const input = orderInput(available.id, 2);
    input.items.push({ productId: empty.id, quantity: 1 });
    await call('post', '/orders', input).expect(409);
    expect(
      await db.order.count({ where: { idempotencyKey: input.idempotencyKey } }),
    ).toBe(0);
    const current = await db.product.findMany({
      where: { id: { in: [available.id, empty.id] } },
    });
    expect(current.find((p) => p.id === available.id)).toMatchObject({
      stock: 5,
      stockVersion: available.stockVersion,
    });
    expect(current.find((p) => p.id === empty.id)).toMatchObject({
      stock: 0,
      stockVersion: empty.stockVersion,
    });
    expect(
      await db.stockMovement.count({
        where: {
          productId: { in: [available.id, empty.id] },
          type: 'ORDER_DEDUCT',
        },
      }),
    ).toBe(0);
  });
  it('rolls back order creation, all stock updates and logs when a movement append fails', async () => {
    const a = await item(5);
    const b = await item(5);
    await reserveNextVersion(
      [a, b].sort((x, y) => x.id.localeCompare(y.id))[1],
    );
    const input = orderInput(a.id, 2);
    input.items.push({ productId: b.id, quantity: 3 });
    const logCount = await db.orderLog.count({ where: { actorId: users[0] } });
    await call('post', '/orders', input).expect(500);
    expect(await db.orderLog.count({ where: { actorId: users[0] } })).toBe(
      logCount,
    );
    expect(
      await db.order.count({ where: { idempotencyKey: input.idempotencyKey } }),
    ).toBe(0);
    for (const p of [a, b]) {
      expect(
        await db.product.findUniqueOrThrow({ where: { id: p.id } }),
      ).toMatchObject({ stock: p.stock, stockVersion: p.stockVersion });
      expect(
        await db.stockMovement.count({
          where: { productId: p.id, type: 'ORDER_DEDUCT' },
        }),
      ).toBe(0);
    }
  });
  it('rolls back cancellation state, logs and all replenishments when its movement append fails', async () => {
    const a = await item(5);
    const b = await item(5);
    const input = orderInput(a.id, 2);
    input.items.push({ productId: b.id, quantity: 3 });
    const order = (await call('post', '/orders', input).expect(201)).body;
    const before = await db.product.findMany({
      where: { id: { in: [a.id, b.id] } },
    });
    await reserveNextVersion(
      [...before].sort((x, y) => x.id.localeCompare(y.id))[1],
    );
    const logCount = await db.orderLog.count({ where: { orderId: order.id } });
    await call('patch', `/orders/${order.id}/cancel`, {
      reason: '测试回滚',
    }).expect(500);
    expect(
      await db.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).toMatchObject({ status: 'PENDING', cancelledAt: null });
    expect(await db.orderLog.count({ where: { orderId: order.id } })).toBe(
      logCount,
    );
    for (const p of before)
      expect(
        await db.product.findUniqueOrThrow({ where: { id: p.id } }),
      ).toMatchObject({ stock: p.stock, stockVersion: p.stockVersion });
    expect(
      await db.stockMovement.count({
        where: { orderId: order.id, type: 'ORDER_CANCEL' },
      }),
    ).toBe(0);
  });
  it('does not add movements for confirmation, shipping or completion and refuses shipped cancellation', async () => {
    const p = await item(5);
    const order = (
      await call('post', '/orders', orderInput(p.id, 2)).expect(201)
    ).body;
    await call('patch', `/orders/${order.id}/confirm`, {}).expect(200);
    await call('patch', `/orders/${order.id}/ship`, {
      carrier: '测试物流',
      trackingNo: 'STOCK001',
    }).expect(200);
    await call('patch', `/orders/${order.id}/cancel`, {
      reason: '已发货取消',
    }).expect(409);
    await call('patch', `/orders/${order.id}/complete`, {}).expect(200);
    expect(await db.stockMovement.count({ where: { orderId: order.id } })).toBe(
      1,
    );
    expect(
      await db.stockMovement.findFirstOrThrow({ where: { orderId: order.id } }),
    ).toMatchObject({ type: 'ORDER_DEDUCT', beforeStock: 5, afterStock: 3 });
    expect(
      await db.product.findUniqueOrThrow({ where: { id: p.id } }),
    ).toMatchObject({ stock: 3, stockVersion: p.stockVersion + 1 });
  });
  it('serializes a manual adjustment with an order without overwriting the deduction', async () => {
    const p = await item(5);
    const [adjustment, order] = await Promise.all([
      call('patch', `/products/${p.id}`, {
        stock: 8,
        stockVersion: p.stockVersion,
        stockReason: '并发盘点',
      }),
      call('post', '/orders', orderInput(p.id)),
    ]);
    expect(order.status).toBe(201);
    expect([200, 409]).toContain(adjustment.status);
    const current = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    const movements = await db.stockMovement.findMany({
      where: { productId: p.id },
      orderBy: { stockVersion: 'asc' },
    });
    expect(current.stock).toBe(adjustment.status === 200 ? 7 : 4);
    expect(movements).toHaveLength(adjustment.status === 200 ? 3 : 2);
    for (let i = 1; i < movements.length; i++) {
      expect(movements[i].beforeStock).toBe(movements[i - 1].afterStock);
      expect(movements[i].stockVersion).toBe(movements[i - 1].stockVersion + 1);
      expect(movements[i].afterStock).toBe(
        movements[i].beforeStock + movements[i].quantityChange,
      );
    }
    expect(movements.at(-1)).toMatchObject({
      afterStock: current.stock,
      stockVersion: current.stockVersion,
    });
    expect(movements.filter((m) => m.type === 'ORDER_DEDUCT')).toHaveLength(1);
  });
});
