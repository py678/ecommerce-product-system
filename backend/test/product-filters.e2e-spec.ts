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

describe.sequential('Product filtering HTTP API (isolated PostgreSQL)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let token: string;
  let userId: string;
  const categoryIds: string[] = [];
  const prefix = `filter_${randomUUID().slice(0, 8)}`;
  const rows: {
    id: string;
    stock: number;
    price: string;
    categoryId: string;
  }[] = [];
  function list(query: object = {}) {
    return request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .query({ name: prefix, ...query });
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
    const user = await db.user.create({
      data: {
        username: prefix,
        email: `${prefix}@example.invalid`,
        passwordHash: await hash('Filter-fixture-password-123!', 12),
      },
    });
    userId = user.id;
    token = await app.get(JwtService).signAsync({ sub: userId });
    for (const name of ['A', 'B'])
      categoryIds.push(
        (await db.category.create({ data: { name: `${prefix}_${name}` } })).id,
      );
    for (const [index, stock] of [0, 1, 5, 6, 7].entries()) {
      const categoryId = categoryIds[index === 4 ? 1 : 0];
      const price = ['0.00', '10.00', '10.00', '20.00', '30.00'][index];
      const p = await db.product.create({
        data: {
          name: `${prefix}_Widget`,
          userId,
          categoryId,
          price,
          stock,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
        },
      });
      rows.push({ id: p.id, stock, price, categoryId });
    }
  });
  afterAll(async () => {
    try {
      if (db && userId) {
        await db.product.deleteMany({ where: { userId } });
        await db.category.deleteMany({ where: { id: { in: categoryIds } } });
        await db.user.delete({ where: { id: userId } });
      }
    } finally {
      if (app) await app.close();
    }
  });
  it('returns compatible lists and product-only defaults, preserving category defaults', async () => {
    const r = await list().expect(200);
    expect(r.body).toMatchObject({
      total: 5,
      page: 1,
      pageSize: 10,
      totalPages: 1,
      lowStockThreshold: 6,
    });
    expect(r.body.list).toEqual(r.body.items);
    const c = await request(app.getHttpServer())
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(c.body.pageSize).toBe(20);
    await request(app.getHttpServer()).get('/api/products').expect(401);
  });
  it('combines case-insensitive name, exact category, inclusive prices and low stock', async () => {
    const r = await list({
      name: prefix.toUpperCase(),
      search: 'does-not-match',
      categoryId: categoryIds[0],
      minPrice: '10',
      maxPrice: '10.00',
      stockStatus: 'low',
      sortBy: 'stock',
      sortOrder: 'asc',
    }).expect(200);
    expect(r.body.list.map((p) => p.stock)).toEqual([1, 5]);
    expect(r.body.total).toBe(2);
    const legacy = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .query({ search: prefix })
      .expect(200);
    expect(legacy.body.total).toBe(5);
  });
  it.each([
    ['zero', [0]],
    ['low', [1, 5]],
    ['normal', [6, 7]],
  ])('covers %s stock boundaries', async (stockStatus, stocks) => {
    const r = await list({
      stockStatus,
      sortBy: 'stock',
      sortOrder: 'asc',
    }).expect(200);
    expect(r.body.list.map((p) => p.stock)).toEqual(stocks);
  });
  it('supports individual bounds, zero prices, empty results and pages past the end', async () => {
    expect((await list({ minPrice: '20' }).expect(200)).body.total).toBe(2);
    expect(
      (await list({ maxPrice: '0' }).expect(200)).body.list.map((p) => p.price),
    ).toEqual(['0.00']);
    expect((await list({ minPrice: '31' }).expect(200)).body).toMatchObject({
      list: [],
      items: [],
      total: 0,
      totalPages: 0,
    });
    expect(
      (await list({ page: 100, pageSize: 1 }).expect(200)).body,
    ).toMatchObject({ list: [], total: 5, page: 100 });
    const r = await list({ pageSize: 100 }).expect(200);
    expect(r.body.pageSize).toBe(100);
  });
  it.each(['price', 'stock', 'createdAt', 'updatedAt'])(
    'sorts %s in both directions with deterministic UUID ties',
    async (sortBy) => {
      for (const sortOrder of ['asc', 'desc']) {
        const sorted = [...rows].sort((a, b) => {
          const value =
            sortBy === 'price'
              ? Number(a.price) - Number(b.price)
              : sortBy === 'stock'
                ? a.stock - b.stock
                : 0;
          const cmp = value || a.id.localeCompare(b.id);
          return sortOrder === 'asc' ? cmp : -cmp;
        });
        const ids: string[] = [];
        for (let page = 1; page <= 3; page++)
          ids.push(
            ...(
              await list({ sortBy, sortOrder, page, pageSize: 2 }).expect(200)
            ).body.list.map((p) => p.id),
          );
        expect(ids).toEqual(sorted.map((p) => p.id));
      }
    },
  );
  it.each([
    { sortBy: 'name' },
    { sortBy: '__proto__' },
    { sortOrder: 'invalid' },
    { stockStatus: 'negative' },
    { minPrice: '2', maxPrice: '1' },
    { pageSize: 101 },
    { page: 0 },
    { minPrice: '1.001' },
    { status: 'draft' },
  ])('returns 400 for invalid query %#', async (q) => {
    await list(q).expect(400);
  });
  it('publishes parameters and deprecations in actual OpenAPI', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const operation = body.paths['/api/products'].get;
    expect(operation.security).toEqual([{ bearer: [] }]);
    const params = Object.fromEntries(
      operation.parameters.map((p) => [p.name, p]),
    );
    for (const name of [
      'name',
      'search',
      'categoryId',
      'minPrice',
      'maxPrice',
      'stockStatus',
      'sortBy',
      'sortOrder',
      'page',
      'pageSize',
    ])
      expect(params[name]).toBeDefined();
    expect(params.search.deprecated ?? params.search.schema.deprecated).toBe(
      true,
    );
    expect(params.pageSize.schema.default).toBe(10);
    expect(params.stockStatus.description).toContain(
      'stock < LOW_STOCK_THRESHOLD',
    );
    const props = body.components.schemas.ProductPageDto.properties;
    expect(props.list).toBeDefined();
    expect(props.items.deprecated).toBe(true);
    expect(props.totalPages.deprecated).toBe(true);
  });
});
