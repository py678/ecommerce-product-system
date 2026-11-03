import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductQueryDto } from '../dist/products/dto/product-query.dto.js';
import { productListQuery } from '../dist/products/product-list-query.js';
import { lowStockThreshold } from '../dist/products/products.config.js';

const query = (input: object = {}) => plainToInstance(ProductQueryDto, input);
const errors = (input: object) =>
  validate(query(input), { whitelist: true, forbidNonWhitelisted: true });

describe('Product query validation and whitelist', () => {
  it('defaults only product pagination to 10 and sorting to createdAt desc', async () => {
    expect(query()).toMatchObject({
      page: 1,
      pageSize: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(
      await errors({
        page: '1',
        pageSize: '100',
        minPrice: '0',
        maxPrice: '9999999999.99',
      }),
    ).toEqual([]);
  });
  it.each([
    { page: '0' },
    { page: '1000001' },
    { page: '1.5' },
    { page: '' },
    { pageSize: '101' },
    { pageSize: '0' },
    { pageSize: ['10', '20'] },
    { sortBy: 'name' },
    { sortBy: '__proto__' },
    { sortBy: 'price; DROP TABLE products' },
    { sortOrder: 'DESC' },
    { stockStatus: 'all' },
    { status: 'draft' },
    { minPrice: '-1' },
    { minPrice: '1.001' },
    { maxPrice: '10000000000' },
    { minPrice: '1e2' },
    { maxPrice: '' },
    { minPrice: '2', maxPrice: '1.99' },
    { minPrice: null },
    { name: '  ' },
    { name: ['a', 'b'] },
    { categoryId: 'abc' },
  ])('rejects invalid query %#', async (input) => {
    expect((await errors(input)).length).toBeGreaterThan(0);
  });
  it('accepts equal bounds and optional one-sided bounds', async () => {
    for (const input of [
      { minPrice: '1.10', maxPrice: '1.1' },
      { minPrice: '0' },
      { maxPrice: '0' },
    ])
      expect(await errors(input)).toEqual([]);
  });
  it('combines all filters and prioritizes name over deprecated search', () => {
    const result = productListQuery(
      query({
        name: 'New',
        search: 'Old',
        categoryId: 'category',
        minPrice: '1.00',
        maxPrice: '5.50',
        stockStatus: 'low',
        sortBy: 'price',
        sortOrder: 'asc',
      }),
      6,
    );
    expect(result).toEqual({
      where: {
        name: { contains: 'New', mode: 'insensitive' },
        categoryId: 'category',
        price: { gte: '1.00', lte: '5.50' },
        stock: { gt: 0, lt: 6 },
      },
      orderBy: [{ price: 'asc' }, { id: 'asc' }],
    });
    expect(productListQuery(query({ search: 'Old' }), 6).where.name).toEqual({
      contains: 'Old',
      mode: 'insensitive',
    });
  });
  it.each(['price', 'stock', 'createdAt', 'updatedAt'])(
    'maps %s explicitly, with id following the primary direction',
    (field) => {
      for (const direction of ['asc', 'desc'])
        expect(
          productListQuery(query({ sortBy: field, sortOrder: direction }), 6)
            .orderBy,
        ).toEqual([{ [field]: direction }, { id: direction }]);
    },
  );
  it('rejects unsafe sort keys even when called without the HTTP validation pipe', () => {
    expect(() =>
      productListQuery(query({ sortBy: 'constructor' }), 6),
    ).toThrow();
  });
  it('uses disjoint stock boundaries and the configured threshold', () => {
    expect(
      productListQuery(query({ stockStatus: 'zero' }), 6).where.stock,
    ).toBe(0);
    expect(
      productListQuery(query({ stockStatus: 'normal' }), 6).where.stock,
    ).toEqual({ gte: 6 });
    expect(
      productListQuery(query({ stockStatus: 'low' }), 12).where.stock,
    ).toEqual({ gt: 0, lt: 12 });
  });
  it('validates global low-stock configuration', () => {
    const before = process.env.LOW_STOCK_THRESHOLD;
    try {
      delete process.env.LOW_STOCK_THRESHOLD;
      expect(lowStockThreshold()).toBe(6);
      process.env.LOW_STOCK_THRESHOLD = '12';
      expect(lowStockThreshold()).toBe(12);
      for (const value of ['0', '-1', '1.5', '', '2147483648']) {
        process.env.LOW_STOCK_THRESHOLD = value;
        expect(() => lowStockThreshold()).toThrow();
      }
    } finally {
      if (before === undefined) delete process.env.LOW_STOCK_THRESHOLD;
      else process.env.LOW_STOCK_THRESHOLD = before;
    }
  });
});
