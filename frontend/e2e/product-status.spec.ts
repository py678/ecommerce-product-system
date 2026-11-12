import { expect, test, type Page } from '@playwright/test';

const ownId = '00000000-0000-4000-8000-000000000001';
const productId = '00000000-0000-4000-8000-000000000003';
const otherId = '00000000-0000-4000-8000-000000000004';
const category = {
  id: '00000000-0000-4000-8000-000000000002',
  name: '测试分类',
};
const timestamp = '2026-01-01T00:00:00Z';
type Status = 'PUBLISHED' | 'OFFLINE';

async function fixture(
  page: Page,
  options: { scope?: 'OWN' | 'ALL'; readOnly?: boolean } = {},
) {
  const user = {
    id: ownId,
    username: 'status_user',
    role: options.readOnly ? 'ADMIN' : 'CUSTOM',
    roleId: 'custom-role',
    roleName: '测试角色',
    email: 'status@example.invalid',
    permissions: [
      'product:read',
      'order:read',
      'order:create',
      ...(options.readOnly ? [] : ['product:update']),
    ],
    dataScopes: { 'product:update': options.scope ?? 'OWN' },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const makeProduct = (
    id: string,
    name: string,
    status: Status,
    userId: string,
  ) => ({
    id,
    name,
    status,
    userId,
    description: '',
    coverImage: null,
    price: '15.00',
    stock: 5,
    stockVersion: 0,
    categoryId: category.id,
    category,
    user: { id: userId, username: userId === ownId ? user.username : 'other' },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const products = [
    makeProduct(productId, '本人上架商品', 'PUBLISHED', ownId),
    makeProduct(otherId, '他人下架商品', 'OFFLINE', otherId),
  ];
  const queries: URLSearchParams[] = [];
  const updates: unknown[] = [];
  let failUpdate = false;
  let holdUpdate: Promise<void> | undefined;
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'mock-status-session'),
  );
  await page.route('**/socket.io/**', (route) => route.abort());
  // Catch every API request, including unexpected mutations: never reach live data.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
    if (url.pathname === '/api/products' && request.method() === 'GET') {
      queries.push(url.searchParams);
      const status = url.searchParams.get('status');
      // Deliberately return a stale offline row to exercise picker defense.
      const list =
        url.searchParams.get('pageSize') === '10' &&
        url.searchParams.get('name') === 'picker'
          ? products
          : products.filter((p) => !status || p.status === status);
      return route.fulfill({
        json: {
          list,
          items: list,
          total: list.length,
          page: Number(url.searchParams.get('page') ?? 1),
          pageSize: 10,
          totalPages: 1,
          lowStockThreshold: 6,
        },
      });
    }
    const match = /^\/api\/products\/([^/]+)(\/status)?$/.exec(url.pathname);
    const product = products.find((p) => p.id === match?.[1]);
    if (product && request.method() === 'GET')
      return route.fulfill({ json: product });
    if (product && match?.[2] && request.method() === 'PATCH') {
      updates.push(request.postDataJSON());
      await holdUpdate;
      if (failUpdate)
        return route.fulfill({
          status: 409,
          json: { message: '状态更新失败，请重试' },
        });
      product.status = request.postDataJSON().status;
      return route.fulfill({ json: product });
    }
    return route.fulfill({
      status: 404,
      json: { message: '测试拦截的未配置请求' },
    });
  });
  return {
    queries,
    updates,
    fail: (value: boolean) => {
      failUpdate = value;
    },
    hold: (value: Promise<void> | undefined) => {
      holdUpdate = value;
    },
  };
}

test('status filter resets page and survives refresh and browser history', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/products?page=3&status=OFFLINE');
  await expect(
    page.getByRole('link', { name: '他人下架商品', exact: true }),
  ).toBeVisible();
  const filter = page.getByRole('combobox', {
    name: '上下架状态',
    exact: true,
  });
  await expect(
    filter.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")]',
    ),
  ).toContainText('已下架');
  await expect.poll(() => state.queries.at(-1)?.get('status')).toBe('OFFLINE');
  await filter.click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('已上架', { exact: true })
    .click();
  await expect
    .poll(() => state.queries.at(-1)?.get('status'))
    .toBe('PUBLISHED');
  expect(state.queries.at(-1)?.get('page')).toBe('1');
  await expect(page).toHaveURL(/status=PUBLISHED/);
  await page.reload();
  await expect(
    page.getByRole('link', { name: '本人上架商品', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('link', { name: '他人下架商品', exact: true }),
  ).toBeVisible();
  await expect.poll(() => state.queries.at(-1)?.get('status')).toBe('OFFLINE');
});

test('list shows status and gates actions by OWN scope', async ({ page }) => {
  await fixture(page);
  await page.goto('/products');
  const own = page.getByRole('row').filter({ hasText: '本人上架商品' });
  const other = page.getByRole('row').filter({ hasText: '他人下架商品' });
  await expect(own.getByText('已上架', { exact: true })).toBeVisible();
  await expect(other.getByText('已下架', { exact: true })).toBeVisible();
  await expect(own.getByRole('button', { name: /^下\s*架$/ })).toBeVisible();
  await expect(other.getByRole('button', { name: /^上\s*架$/ })).toHaveCount(0);
});

test('custom ALL scope can publish another owner product after confirmation', async ({
  page,
}) => {
  const state = await fixture(page, { scope: 'ALL' });
  await page.goto('/products');
  const other = page.getByRole('row').filter({ hasText: '他人下架商品' });
  await other.getByRole('button', { name: /^上\s*架$/ }).click();
  expect(state.updates).toHaveLength(0);
  await page
    .locator('.ant-popconfirm')
    .getByRole('button', { name: /^上\s*架$/ })
    .click();
  await expect(other.getByText('已上架', { exact: true })).toBeVisible();
  expect(state.updates).toEqual([{ status: 'PUBLISHED' }]);
});

test('list update preserves state on failure and retries with pending feedback', async ({
  page,
}) => {
  const state = await fixture(page);
  state.fail(true);
  await page.goto('/products');
  const own = page.getByRole('row').filter({ hasText: '本人上架商品' });
  await own.getByRole('button', { name: /^下\s*架$/ }).click();
  await page
    .locator('.ant-popconfirm')
    .getByRole('button', { name: /^下\s*架$/ })
    .click();
  await expect(page.getByText('状态更新失败，请重试')).toBeVisible();
  await expect(own.getByText('已上架', { exact: true })).toBeVisible();
  state.fail(false);
  let release!: () => void;
  state.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const updatesBeforeRetry = state.updates.length;
  try {
    const trigger = own.getByRole('button', { name: /^下\s*架$/ });
    await trigger.click();
    const confirm = page
      .locator('.ant-popconfirm')
      .getByRole('button', { name: /^下\s*架$/ });
    await confirm.click();
    await expect.poll(() => state.updates.length).toBe(updatesBeforeRetry + 1);
    const loadingTrigger = own.locator('button.ant-btn-loading');
    await expect(loadingTrigger).toBeVisible();
    await expect(loadingTrigger).toBeDisabled();
    // Native activation exercises the pending guard without Playwright waiting
    // for loading/disabled buttons to become actionable after the request.
    await loadingTrigger.evaluate((button) =>
      (button as HTMLButtonElement).click(),
    );
    const loadingConfirm = page.locator(
      '.ant-popconfirm button.ant-btn-primary',
    );
    if (await loadingConfirm.isVisible())
      await loadingConfirm.evaluate((button) =>
        (button as HTMLButtonElement).click(),
      );
    await page.waitForTimeout(150);
    expect(state.updates).toHaveLength(updatesBeforeRetry + 1);
  } finally {
    release();
  }
  await expect(own.getByText('已下架', { exact: true })).toBeVisible();
  expect(state.updates).toHaveLength(updatesBeforeRetry + 1);
});

test('detail shows current status, confirms and refreshes after status change', async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`/products/${productId}`);
  await expect(page.getByText('已上架', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^下\s*架$/ }).click();
  await page
    .locator('.ant-popconfirm')
    .getByRole('button', { name: /^下\s*架$/ })
    .click();
  await expect(page.getByText('已下架', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^上\s*架$/ })).toBeVisible();
});

test('role name ADMIN without update permission cannot change list or detail status', async ({
  page,
}) => {
  await fixture(page, { readOnly: true });
  await page.goto('/products');
  await expect(
    page.getByRole('link', { name: '本人上架商品', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^(上\s*架|下\s*架)$/ }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: '本人上架商品', exact: true }).click();
  await expect(page.getByText('已上架', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^(上\s*架|下\s*架)$/ }),
  ).toHaveCount(0);
});

test('order picker requests published products and hides stale offline results', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/orders/new');
  await page.getByRole('button', { name: '选择商品', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('本人上架商品', { exact: true })).toBeVisible();
  expect(state.queries.at(-1)?.get('status')).toBe('PUBLISHED');
  await dialog.getByLabel('搜索可选商品', { exact: true }).fill('picker');
  await dialog.getByLabel('搜索可选商品', { exact: true }).press('Enter');
  await expect.poll(() => state.queries.at(-1)?.get('name')).toBe('picker');
  await expect(dialog.getByText('他人下架商品', { exact: true })).toHaveCount(
    0,
  );
  await dialog.getByRole('button', { name: '加入订单', exact: true }).click();
  await dialog.getByRole('button', { name: '完成选择', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: '本人上架商品' }),
  ).toBeVisible();
});
