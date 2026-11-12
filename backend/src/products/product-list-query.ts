import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import {
  ProductQueryDto,
  ProductSortBy,
  SortOrder,
  StockStatus,
} from './dto/product-query.dto.js';

// Required (NOT NULL) columns cannot contain nulls, so their ordering already
// satisfies NULLS LAST. Prisma only accepts an explicit nulls option for nullable
// columns. If a column becomes nullable, add { sort, nulls: 'last' } here.
const SORT_FIELDS = new Map<
  ProductSortBy,
  (order: SortOrder) => Prisma.ProductOrderByWithRelationInput
>([
  [ProductSortBy.Price, (order) => ({ price: order })],
  [ProductSortBy.Stock, (order) => ({ stock: order })],
  [ProductSortBy.CreatedAt, (order) => ({ createdAt: order })],
  [ProductSortBy.UpdatedAt, (order) => ({ updatedAt: order })],
]);

export function productListQuery(query: ProductQueryDto, threshold: number) {
  const sort = SORT_FIELDS.get(query.sortBy);
  if (!sort || !Object.values(SortOrder).includes(query.sortOrder))
    throw new BadRequestException('无效的排序字段或方向');
  const name = query.name ?? query.search;
  const where: Prisma.ProductWhereInput = {
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.minPrice !== undefined || query.maxPrice !== undefined
      ? {
          price: {
            ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
            ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
          },
        }
      : {}),
    ...(query.stockStatus === StockStatus.Zero ? { stock: 0 } : {}),
    ...(query.stockStatus === StockStatus.Low
      ? { stock: { gt: 0, lt: threshold } }
      : {}),
    ...(query.stockStatus === StockStatus.Normal
      ? { stock: { gte: threshold } }
      : {}),
  };
  return { where, orderBy: [sort(query.sortOrder), { id: query.sortOrder }] };
}
