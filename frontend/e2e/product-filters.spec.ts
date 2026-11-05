import { test, expect } from '@playwright/test';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'filter_user',
  role: 'OPERATOR',
  permissions: [
    'product:read',
    'product:create',
    'product:update',
    'product:delete',
    'category:read',
    'upload:image',
  ],
  email: 'filter@example.invalid',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const categoryId = '00000000-0000-4000-8000-000000000002';
const product = {
  id: '00000000-0000-4000-8000-000000000003',
  name: 'List contract product',
  description: '',
  coverImage: null,
  price: '15.00',
  stock: 5,
  userId: user.id,
  categoryId,
  user,
  category: { id: categoryId, name: 'Filter category' },
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'mock-filter-session'),
  );
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: user }));
  await page.route('**/api/categories?*', (route) =>
    route.fulfill({
      json: {
        items: [{ id: categoryId, name: 'Filter category', productCount: 1 }],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      },
    }),
  );
  await page.route('**/api/products?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const empty = params.get('name') === 'no-result';
    return route.fulfill({
      json: {
        list: empty ? [] : [product],
        items: [],
        total: empty ? 0 : 50,
        page: Number(params.get('page')),
        pageSize: Number(params.get('pageSize')),
        totalPages: 5,
        lowStockThreshold: 6,
      },
    });
  });
});

test('debounces filter changes, resets page, uses list and restores URL on refresh/back/forward', async ({
  page,
}) => {
  const requests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/products') requests.push(url.searchParams);
  });
  await page.goto(
    '/products?page=3&pageSize=10&name=old&minPrice=10&maxPrice=20&sortBy=price&sortOrder=asc&stockStatus=low',
  );
  await expect(
    page.getByRole('link', { name: product.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('最低价', { exact: true })).toHaveValue('10');
  await expect(page.getByLabel('搜索商品', { exact: true })).toHaveValue('old');
  requests.length = 0;
  await page.getByLabel('搜索商品', { exact: true }).fill('intermediate');
  await page.getByLabel('搜索商品', { exact: true }).fill('Widget');
  await expect.poll(() => requests.at(-1)?.get('name')).toBe('Widget');
  expect(requests.some((q) => q.get('name') === 'intermediate')).toBe(false);
  expect(requests.at(-1)?.get('page')).toBe('1');
  expect(requests.at(-1)?.get('minPrice')).toBe('10');
  expect(requests.at(-1)?.get('stockStatus')).toBe('low');
  await expect(page).toHaveURL(/name=Widget/);
  await page.reload();
  await expect(page.getByLabel('搜索商品', { exact: true })).toHaveValue(
    'Widget',
  );
  await expect(page.getByLabel('最高价', { exact: true })).toHaveValue('20');
  await page.getByLabel('最低价', { exact: true }).fill('11');
  await expect.poll(() => requests.at(-1)?.get('minPrice')).toBe('11');
  await page.goBack();
  await expect(page.getByLabel('最低价', { exact: true })).toHaveValue('10');
  await expect.poll(() => requests.at(-1)?.get('minPrice')).toBe('10');
  await page.goForward();
  await expect(page.getByLabel('最低价', { exact: true })).toHaveValue('11');
  await expect.poll(() => requests.at(-1)?.get('minPrice')).toBe('11');
});

test('sends selected category, stock and sorting controls in the URL and request', async ({
  page,
}) => {
  await page.goto('/products?page=2');
  await expect(
    page.getByRole('link', { name: product.name, exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: '全部分类', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('Filter category', { exact: true })
    .click();
  await page.getByRole('combobox', { name: '库存状态', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('正常库存', { exact: true })
    .click();
  await page.getByRole('combobox', { name: '排序字段', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('库存', { exact: true })
    .click();
  const response = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === '/api/products' &&
      url.searchParams.get('sortOrder') === 'asc'
    );
  });
  await page.getByRole('combobox', { name: '排序方向', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('升序', { exact: true })
    .click();
  const params = new URL((await response).url()).searchParams;
  expect(params.get('categoryId')).toBe(categoryId);
  expect(params.get('stockStatus')).toBe('normal');
  expect(params.get('sortBy')).toBe('stock');
  expect(params.get('page')).toBe('1');
  expect(params.get('pageSize')).toBe('10');
  expect(new URL(page.url()).searchParams.get('categoryId')).toBe(categoryId);
});

test('waits for Chinese composition to finish before searching or updating the URL', async ({
  page,
}) => {
  const requests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/products') requests.push(url.searchParams);
  });
  await page.goto(`/products?categoryId=${categoryId}`);
  await expect(
    page.getByRole('link', { name: product.name, exact: true }),
  ).toBeVisible();
  requests.length = 0;
  const search = page.getByLabel('搜索商品', { exact: true });
  await search.focus();
  await search.dispatchEvent('compositionstart');
  await search.fill("shou'ji");
  // Deliberately wait longer than the debounce: unfinished IME text must not search.
  await page.waitForTimeout(450);
  expect(requests).toHaveLength(0);
  expect(new URL(page.url()).searchParams.has('name')).toBe(false);
  await expect(search).toBeFocused();
  await search.evaluate((input) => {
    const element = input as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, '手机');
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: '手机',
        isComposing: true,
      }),
    );
    element.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '手机' }),
    );
  });
  await expect.poll(() => requests.at(-1)?.get('name')).toBe('手机');
  expect(requests.some((query) => query.get('name') === "shou'ji")).toBe(false);
  expect(new URL(page.url()).searchParams.get('name')).toBe('手机');
  expect(new URL(page.url()).searchParams.get('categoryId')).toBe(categoryId);
  await expect(search).toHaveValue('手机');
  await expect(search).toBeFocused();
});

test('shows field errors, empty results, loading and retryable request errors', async ({
  page,
}) => {
  await page.goto('/products?minPrice=20&maxPrice=10');
  await expect(page.getByText('最高价必须大于或等于最低价')).toBeVisible();
  await page.getByLabel('最高价', { exact: true }).fill('30');
  await expect(
    page.getByRole('link', { name: product.name, exact: true }),
  ).toBeVisible();
  await page.getByLabel('搜索商品', { exact: true }).fill('no-result');
  await expect(page.getByText('没有找到符合条件的商品')).toBeVisible();
  await page.route('**/api/products?*', (route) => route.abort(), { times: 1 });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(
    page.getByText('无法连接服务器，请检查网络后重试'),
  ).toBeVisible();
  await page.getByRole('button', { name: /^重\s*试$/ }).click();
  await expect(
    page.getByText('无法连接服务器，请检查网络后重试'),
  ).not.toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/api/products?*',
    async (route) => {
      await held;
      await route.fulfill({
        json: {
          list: [product],
          total: 1,
          page: 1,
          pageSize: 10,
          lowStockThreshold: 6,
        },
      });
    },
    { times: 1 },
  );
  await page.getByLabel('搜索商品', { exact: true }).fill('loading');
  await expect(
    page.locator('.ant-table-wrapper .ant-spin-spinning'),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole('link', { name: product.name, exact: true }),
  ).toBeVisible();
});
