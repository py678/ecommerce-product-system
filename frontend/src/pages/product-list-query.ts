import type { ProductListQuery } from '../api/types';

export const productSortFields = [
  'price',
  'stock',
  'createdAt',
  'updatedAt',
] as const;
export const stockStatuses = ['zero', 'low', 'normal'] as const;
const pricePattern = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$(?![\s\S])/;

export function readProductQuery(params: URLSearchParams): ProductListQuery {
  const integer = (key: string, fallback: number, max: number) => {
    const raw = params.get(key);
    return raw && /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= max
      ? Number(raw)
      : fallback;
  };
  const sortBy = params.get('sortBy');
  const stockStatus = params.get('stockStatus');
  return {
    page: integer('page', 1, 1000000),
    pageSize: integer('pageSize', 10, 100),
    name: params.get('name') ?? params.get('search') ?? undefined,
    categoryId: params.get('categoryId') || undefined,
    minPrice: params.get('minPrice') ?? undefined,
    maxPrice: params.get('maxPrice') ?? undefined,
    stockStatus: stockStatuses.find((value) => value === stockStatus),
    sortBy: productSortFields.find((value) => value === sortBy) ?? 'createdAt',
    sortOrder: params.get('sortOrder') === 'asc' ? 'asc' : 'desc',
  };
}

export function productQueryErrors(query: ProductListQuery) {
  const errors: { minPrice?: string; maxPrice?: string; name?: string } = {};
  if (
    query.name !== undefined &&
    (!query.name.trim() || query.name.trim().length > 200)
  )
    errors.name = '名称须为 1～200 个字符';
  for (const field of ['minPrice', 'maxPrice'] as const) {
    const value = query[field];
    if (value !== undefined && !pricePattern.test(value))
      errors[field] = '请输入非负金额，最多 10 位整数和 2 位小数';
  }
  // Valid values fit the safe integer range when converted to cents.
  const cents = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  };
  if (
    !errors.minPrice &&
    !errors.maxPrice &&
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    cents(query.minPrice) > cents(query.maxPrice)
  )
    errors.maxPrice = '最高价必须大于或等于最低价';
  return errors;
}
