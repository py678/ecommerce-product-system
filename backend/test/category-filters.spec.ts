import { CategoriesService } from '../dist/categories/categories.service.js';
import type { DatabaseService } from '../dist/database/database.service.js';
import type { RealtimeService } from '../dist/realtime/realtime.service.js';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CategoryQueryDto } from '../dist/categories/dto/category.dto.js';

describe('Category query DTO', () => {
  it.each([undefined, 'with', 'without'])(
    'accepts %s without changing default page size',
    async (productPresence) => {
      const dto = plainToInstance(CategoryQueryDto, { productPresence });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.pageSize).toBe(20);
    },
  );
  it.each(['all', '', null, ['with', 'without']])(
    'rejects invalid presence %j',
    async (productPresence) => {
      expect(
        (await validate(plainToInstance(CategoryQueryDto, { productPresence })))
          .length,
      ).toBeGreaterThan(0);
    },
  );
});

describe('Category product-presence query', () => {
  it.each(['with', 'without', undefined] as const)(
    'filters %s before pagination with identical list/count conditions',
    async (productPresence) => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(0);
      const db = {
        category: { findMany, count },
        $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      };
      const service = new CategoriesService(
        db as unknown as DatabaseService,
        {} as RealtimeService,
      );
      await service.findAll({
        page: 2,
        pageSize: 20,
        search: '数码',
        productPresence,
      } as never);
      const where = findMany.mock.calls[0][0].where;
      expect(where.products).toEqual(
        productPresence === 'with'
          ? { some: {} }
          : productPresence === 'without'
            ? { none: {} }
            : undefined,
      );
      expect(where.name).toEqual({ contains: '数码', mode: 'insensitive' });
      expect(count.mock.calls[0][0].where).toBe(where);
      expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 20 });
    },
  );
});
