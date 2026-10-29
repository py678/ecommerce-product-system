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

describe.sequential('Catalog HTTP API (real PostgreSQL)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let token: string;
  let otherToken: string;
  const prefix = `catalog_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const userIds: string[] = [];
  const categoryIds = new Set<string>();
  let categoryId: string;
  let otherCategoryId: string;
  let productId: string;
  const missingId = randomUUID();

  function category(body: object, auth = token) {
    return request(app.getHttpServer())
      .post('/api/categories')
      .set('Authorization', `Bearer ${auth}`)
      .send(body);
  }

  function product(body: object, auth = token) {
    return request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${auth}`)
      .send(body);
  }

  function validProduct(overrides: object = {}) {
    return {
      name: `${prefix}_product`,
      price: '19.90',
      stock: 3,
      categoryId,
      ...overrides,
    };
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
    const jwt = app.get(JwtService);
    const passwordHash = await hash('Catalog-test-password-123!', 12);
    for (const suffix of ['owner', 'other']) {
      const user = await db.user.create({
        data: {
          username: `${prefix}_${suffix}`,
          email: `${prefix}_${suffix}@example.invalid`,
          passwordHash,
        },
      });
      userIds.push(user.id);
    }
    token = await jwt.signAsync({ sub: userIds[0] });
    otherToken = await jwt.signAsync({ sub: userIds[1] });
    for (const suffix of ['A', 'B']) {
      const response = await category({ name: `${prefix}_${suffix}` }).expect(
        201,
      );
      categoryIds.add(response.body.id);
      if (suffix === 'A') categoryId = response.body.id;
      else otherCategoryId = response.body.id;
    }
    const response = await product(validProduct()).expect(201);
    productId = response.body.id;
  });

  afterAll(async () => {
    try {
      if (db) {
        await db.product.deleteMany({ where: { userId: { in: userIds } } });
        await db.category.deleteMany({
          where: { id: { in: [...categoryIds] } },
        });
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('creates, reads, edits and deletes a shared category', async () => {
    const created = await category({ name: ` ${prefix}_CRUD ` }).expect(201);
    const id = created.body.id;
    categoryIds.add(id);
    expect(created.body).toMatchObject({
      name: `${prefix}_CRUD`,
      productCount: 0,
    });
    await request(app.getHttpServer())
      .get(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    const updated = await request(app.getHttpServer())
      .patch(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: ` ${prefix}_renamed ` })
      .expect(200);
    expect(updated.body.name).toBe(`${prefix}_renamed`);
    await request(app.getHttpServer())
      .delete(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204)
      .expect('');
    await request(app.getHttpServer())
      .get(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('creates, reads, partially updates and deletes an owned product', async () => {
    const created = await product(
      validProduct({ name: ` ${prefix}_CRUD `, price: '0', stock: 0 }),
    ).expect(201);
    const id = created.body.id;
    expect(created.body).toMatchObject({
      name: `${prefix}_CRUD`,
      price: '0.00',
      stock: 0,
      description: '',
      userId: userIds[0],
      categoryId,
    });
    expect(created.body.user).toEqual({
      id: userIds[0],
      username: `${prefix}_owner`,
    });
    expect(created.body.category).toEqual({
      id: categoryId,
      name: `${prefix}_A`,
    });
    const detail = await request(app.getHttpServer())
      .get(`/api/products/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body).toEqual(created.body);
    const updated = await request(app.getHttpServer())
      .patch(`/api/products/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        price: '9.9',
        stock: 5,
        categoryId: otherCategoryId,
        description: 'Updated description',
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      name: `${prefix}_CRUD`,
      price: '9.90',
      stock: 5,
      categoryId: otherCategoryId,
    });
    const nameOnly = await request(app.getHttpServer())
      .patch(`/api/products/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `${prefix}_name_only` })
      .expect(200);
    expect(nameOnly.body).toMatchObject({
      price: '9.90',
      stock: 5,
      description: 'Updated description',
      categoryId: otherCategoryId,
    });
    await request(app.getHttpServer())
      .delete(`/api/products/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204)
      .expect('');
    await request(app.getHttpServer())
      .get(`/api/products/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('supports the maximum money/stock values and defaults optional fields', async () => {
    const response = await product({
      name: `${prefix}_max`,
      price: '9999999999.99',
      categoryId,
      stock: 2147483647,
    }).expect(201);
    expect(response.body).toMatchObject({
      price: '9999999999.99',
      stock: 2147483647,
    });
    const defaults = await product({
      name: `${prefix}_defaults`,
      price: '1',
      categoryId,
    }).expect(201);
    expect(defaults.body).toMatchObject({
      price: '1.00',
      stock: 0,
      description: '',
    });
  });

  it('allows authenticated shared reads but forbids changing another user’s product', async () => {
    await request(app.getHttpServer())
      .get(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Hijacked' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    const stored = await db.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(stored.name).toBe(`${prefix}_product`);
    expect(stored.userId).toBe(userIds[0]);
  });

  it('blocks deletion of referenced categories and reports their product counts', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.productCount).toBeGreaterThan(0);
    await request(app.getHttpServer())
      .delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(
      await db.category.findUnique({ where: { id: categoryId } }),
    ).not.toBeNull();
  });

  it('paginates and filters products with a stable order and correct totals', async () => {
    await db.product.createMany({
      data: [0, 1, 2].map((index) => ({
        name: `${prefix}_page_${index}`,
        price: '1.25',
        stock: index,
        userId: userIds[0],
        categoryId,
      })),
    });
    const query = {
      page: 1,
      pageSize: 2,
      search: `${prefix}_PAGE_`,
      categoryId,
    };
    const first = await request(app.getHttpServer())
      .get('/api/products')
      .query(query)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/api/products')
      .query({ ...query, page: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(first.body).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 2,
      totalPages: 2,
    });
    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(1);
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map((item) => item.id),
      ).size,
    ).toBe(3);
    for (const item of first.body.items) {
      expect(item.user).not.toHaveProperty('passwordHash');
      expect(item.user).not.toHaveProperty('email');
      expect(item.price).toBe('1.25');
    }
    const empty = await request(app.getHttpServer())
      .get('/api/products')
      .query({ ...query, categoryId: otherCategoryId })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(empty.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
    const beyond = await request(app.getHttpServer())
      .get('/api/products')
      .query({ ...query, page: 10 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(beyond.body).toMatchObject({ items: [], total: 3 });
  });

  it('paginates category search results and applies default pagination', async () => {
    for (const index of [0, 1, 2]) {
      const response = await category({
        name: `${prefix}_cat_page_${index}`,
      }).expect(201);
      categoryIds.add(response.body.id);
    }
    const response = await request(app.getHttpServer())
      .get('/api/categories')
      .query({ search: `${prefix}_CAT_PAGE_`, pageSize: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 2,
      totalPages: 2,
    });
    expect(response.body.items).toHaveLength(2);
    const defaults = await request(app.getHttpServer())
      .get('/api/categories')
      .query({ search: `${prefix}_cat_page_` })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(defaults.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
  });

  it.each([
    '-1',
    'NaN',
    'Infinity',
    '1e3',
    '1.234',
    '10000000000.00',
    '01.00',
    '1.00\n',
    '',
    null,
    -1,
    0,
  ])('rejects invalid price %#', async (price) => {
    await product(validProduct({ price })).expect(400);
    await request(app.getHttpServer())
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price })
      .expect(400);
  });

  it.each([-1, 1.5, '2', 2147483648, null])(
    'rejects invalid stock %#',
    async (stock) => {
      await product(validProduct({ stock })).expect(400);
      await request(app.getHttpServer())
        .patch(`/api/products/${productId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stock })
        .expect(400);
    },
  );

  it.each([
    { name: '   ' },
    { name: 'x'.repeat(201) },
    { name: null },
    { description: null },
    { description: 'x'.repeat(10001) },
    { categoryId: null },
    { categoryId: 'not-a-uuid' },
    { userId: randomUUID() },
    { id: randomUUID() },
  ])('rejects invalid fields and ownership spoofing %#', async (fields) => {
    await product(validProduct(fields)).expect(400);
    await request(app.getHttpServer())
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(fields)
      .expect(400);
  });

  it.each([
    { name: null },
    { name: '  ' },
    { name: 'x'.repeat(121) },
    { name: 123 },
    { name: 'Valid', parentId: randomUUID() },
  ])('rejects invalid category data %#', async (fields) => {
    await category(fields).expect(400);
    await request(app.getHttpServer())
      .patch(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(fields)
      .expect(400);
  });

  it('rejects empty updates and unknown category references', async () => {
    await request(app.getHttpServer())
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    await product(validProduct({ categoryId: missingId })).expect(400);
    await request(app.getHttpServer())
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: missingId })
      .expect(400);
  });

  it.each(['products', 'categories'])(
    'returns 404 and validates path IDs for %s',
    async (resource) => {
      await request(app.getHttpServer())
        .get(`/api/${resource}/${missingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/${resource}/${missingId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/${resource}/${missingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      for (const method of ['get', 'patch', 'delete'] as const) {
        const api = request(app.getHttpServer());
        await api[method](`/api/${resource}/not-a-uuid`)
          .set('Authorization', `Bearer ${token}`)
          .send({ name: 'Updated' })
          .expect(400);
      }
    },
  );

  it.each([
    { page: 0 },
    { page: -1 },
    { page: '1.5' },
    { page: '0x10' },
    { page: '1e2' },
    { page: '1\n' },
    { page: '' },
    { page: ['1', '2'] },
    { page: 1000001 },
    { pageSize: 0 },
    { pageSize: 101 },
    { search: '  ' },
    { search: 'x'.repeat(101) },
    { unexpected: 'field' },
  ])('rejects invalid pagination/search input %#', async (query) => {
    for (const resource of ['products', 'categories']) {
      await request(app.getHttpServer())
        .get(`/api/${resource}`)
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    }
  });

  it('rejects malformed category filters', async () => {
    await request(app.getHttpServer())
      .get('/api/products')
      .query({ categoryId: 'bad-id' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it.each(['products', 'categories'])(
    'requires authentication for every %s action',
    async (resource) => {
      await request(app.getHttpServer()).get(`/api/${resource}`).expect(401);
      await request(app.getHttpServer())
        .post(`/api/${resource}`)
        .send({})
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/${resource}/${missingId}`)
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/api/${resource}/${missingId}`)
        .send({})
        .expect(401);
      await request(app.getHttpServer())
        .delete(`/api/${resource}/${missingId}`)
        .expect(401);
    },
  );

  it('publishes protected CRUD operations, response schemas and query parameters in Swagger', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    for (const resource of ['products', 'categories']) {
      for (const method of ['get', 'post']) {
        expect(
          response.body.paths[`/api/${resource}`][method].security,
        ).toEqual([{ bearer: [] }]);
      }
      for (const method of ['get', 'patch', 'delete']) {
        expect(
          response.body.paths[`/api/${resource}/{id}`][method].security,
        ).toEqual([{ bearer: [] }]);
      }
    }
    expect(
      response.body.components.schemas.ProductResponseDto.properties.price.type,
    ).toBe('string');
    expect(
      response.body.paths['/api/products'].get.parameters.map(
        (param: { name: string }) => param.name,
      ),
    ).toEqual(
      expect.arrayContaining(['page', 'pageSize', 'search', 'categoryId']),
    );
  });
});
