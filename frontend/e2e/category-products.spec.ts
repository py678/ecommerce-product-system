import { expect, test, type Page } from '@playwright/test';

const categoryId = '00000000-0000-4000-8000-000000000002';
async function fixture(page: Page, readable: boolean) {
  const queries: URLSearchParams[] = [];
  const categories = [
    {
      id: categoryId,
      name: '数码产品',
      productCount: 2,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: '空分类',
      productCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'mock-category-session'),
  );
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me')
      return route.fulfill({
        json: {
          id: 'category-user',
          username: 'category_user',
          role: 'CUSTOM',
          roleName: '测试角色',
          email: 'category@example.invalid',
          permissions: ['category:read', ...(readable ? ['product:read'] : [])],
          dataScopes: { 'product:read': 'OWN' },
        },
      });
    if (url.pathname === '/api/categories')
      return route.fulfill({
        json: {
          items: categories,
          total: 2,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        },
      });
    if (url.pathname === '/api/products') {
      queries.push(url.searchParams);
      return route.fulfill({
        json: {
          list: [],
          items: [],
          total: 0,
          page: 1,
          pageSize: 10,
          lowStockThreshold: 6,
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { message: 'Unconfigured mock' },
    });
  });
  return queries;
}

test('category product count opens filtered products on page one, including empty categories', async ({
  page,
}) => {
  const queries = await fixture(page, true);
  await page.goto('/categories');
  await page.getByRole('link', { name: '查看数码产品分类下的商品' }).click();
  await expect.poll(() => queries.at(-1)?.get('categoryId')).toBe(categoryId);
  expect(queries.at(-1)?.get('page')).toBe('1');
  await expect(page).toHaveURL(/categoryId=/);
  await page.reload();
  await expect(page.getByText('数码产品', { exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: '查看空分类分类下的商品' }).click();
  await expect
    .poll(() => queries.at(-1)?.get('categoryId'))
    .toBe('00000000-0000-4000-8000-000000000003');
  await expect(
    page.getByText('没有找到符合条件的商品', { exact: true }),
  ).toBeVisible();
});

test('category-only role sees plain counts without product links or requests', async ({
  page,
}) => {
  const queries = await fixture(page, false);
  await page.goto('/categories');
  await expect(page.getByText('2 件商品', { exact: true })).toBeVisible();
  await expect(page.getByText('0 件商品', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /分类下的商品/ })).toHaveCount(0);
  expect(queries).toHaveLength(0);
});
