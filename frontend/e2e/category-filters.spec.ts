import { expect, test } from '@playwright/test';

test('presence filter combines search, resets page, survives refresh and shows empty results', async ({
  page,
}) => {
  const queries: URLSearchParams[] = [];
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'mock-category-filter'),
  );
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me')
      return route.fulfill({
        json: {
          id: 'filter-user',
          username: 'filter_user',
          role: 'CUSTOM',
          roleName: '分类查看',
          permissions: ['category:read'],
          dataScopes: {},
        },
      });
    if (url.pathname === '/api/categories') {
      queries.push(url.searchParams);
      const empty = url.searchParams.get('productPresence') === 'without';
      return route.fulfill({
        json: {
          items: empty
            ? []
            : [
                {
                  id: 'category-test',
                  name: '数码',
                  productCount: 1,
                  createdAt: '2026-01-01T00:00:00Z',
                },
              ],
          total: empty ? 0 : 21,
          page: Number(url.searchParams.get('page') || 1),
          pageSize: 20,
          totalPages: empty ? 0 : 2,
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { message: 'Unconfigured mock' },
    });
  });
  await page.goto('/categories');
  await page.getByRole('searchbox', { name: '搜索分类' }).fill('数码');
  await page.getByRole('searchbox', { name: '搜索分类' }).press('Enter');
  await expect.poll(() => queries.at(-1)?.get('search')).toBe('数码');
  await page.getByTitle('2', { exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('page')).toBe('2');
  const filter = page.getByRole('combobox', { name: '关联商品筛选' });
  await filter.click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('无商品', { exact: true })
    .click();
  await expect
    .poll(() => queries.at(-1)?.get('productPresence'))
    .toBe('without');
  expect(queries.at(-1)?.get('page')).toBe('1');
  expect(queries.at(-1)?.get('search')).toBe('数码');
  await expect(
    page.getByText('没有找到符合条件的分类', { exact: true }),
  ).toBeVisible();
  const before = queries.length;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(before);
  expect(queries.at(-1)?.get('productPresence')).toBe('without');
  await filter.click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('有商品', { exact: true })
    .click();
  await expect.poll(() => queries.at(-1)?.get('productPresence')).toBe('with');
  await expect(page.getByText('数码', { exact: true })).toBeVisible();
  await filter.click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('全部', { exact: true })
    .click();
  await expect.poll(() => queries.at(-1)?.has('productPresence')).toBe(false);
});
