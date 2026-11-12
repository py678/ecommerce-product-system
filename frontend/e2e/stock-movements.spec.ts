import { test, expect, type Page } from '@playwright/test';

const id = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000001';
async function setup(page: Page, scope: string | null = 'OWN', owner = userId) {
  // 所有流水请求均由fixture接管，避免伪造令牌落到真实API并撤销测试会话。
  await page.route('**/api/**/stock-movements?*', (r) =>
    r.fulfill({ json: { list: [], total: 0, page: 1, pageSize: 10 } }),
  );
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'stock-fixture'),
  );
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      json: {
        id: userId,
        username: '运营',
        role: 'OPERATOR',
        roleName: '运营人员',
        permissions: [
          'product:read',
          'product:update',
          'category:read',
          'order:read',
          ...(scope ? ['stock:read'] : []),
        ],
        dataScopes: {
          'product:read': 'ALL',
          'product:update': 'OWN',
          'stock:read': scope,
          'order:read': 'OWN',
        },
      },
    }),
  );
  const product = {
    id,
    userId: owner,
    name: '流水商品',
    stock: 8,
    stockVersion: 2,
    price: '10.00',
    description: '',
    categoryId: 'category',
    category: { id: 'category', name: '分类' },
    user: { id: owner, username: '运营' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await page.route('**/api/products/' + id, (r) =>
    r.fulfill({ json: product }),
  );
  await page.route('**/api/categories?*', (r) =>
    r.fulfill({ json: { items: [], total: 0 } }),
  );
  return product;
}
const movement = {
  id: 'movement',
  productId: id,
  productName: '流水商品',
  type: 'ORDER_DEDUCT',
  beforeStock: 10,
  quantityChange: -2,
  afterStock: 8,
  stockVersion: 2,
  actorName: '运营',
  orderId: 'restricted-order',
  orderNo: 'ORD-SAFE',
  canViewOrder: false,
  reason: '订单扣减',
  createdAt: '2026-01-01T00:00:00Z',
};

test('流水加载、筛选分页、刷新保留条件和失败重试，受限订单不链接', async ({
  page,
}) => {
  await setup(page);
  let fail = false;
  await page.route('**/api/products/' + id + '/stock-movements?*', (r) =>
    r.fulfill(
      fail
        ? { status: 500, json: { message: '流水暂不可用' } }
        : { json: { list: [movement], total: 12, page: 1, pageSize: 10 } },
    ),
  );
  await page.goto('/products/' + id);
  await page.getByRole('tab', { name: '库存流水' }).click();
  await expect(
    page.getByText('订单扣减', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'ORD-SAFE' })).toHaveCount(0);
  await page.getByPlaceholder('筛选订单号').fill('ORD');
  await page.getByRole('combobox', { name: '变动类型' }).click();
  await page
    .locator('.ant-select-item-option')
    .filter({ hasText: '订单扣减' })
    .click();
  await page.getByPlaceholder('开始日期').fill('2026-01-01');
  await page.getByPlaceholder('开始日期').press('Enter');
  await page.getByPlaceholder('结束日期').fill('2026-01-31');
  await page.getByPlaceholder('结束日期').press('Enter');
  await page.getByRole('button', { name: '查询流水' }).click();
  const next = page.waitForRequest(
    (r) =>
      r.url().includes('stock-movements?') &&
      new URL(r.url()).searchParams.get('page') === '2',
  );
  await page.getByTitle('2', { exact: true }).click();
  await next;
  fail = true;
  await page.getByRole('button', { name: '刷新流水' }).click();
  await expect(page.getByText('流水暂不可用')).toBeVisible();
  fail = false;
  const retry = page.waitForRequest(
    (r) =>
      r.url().includes('stock-movements?') &&
      new URL(r.url()).searchParams.get('orderNo') === 'ORD' &&
      new URL(r.url()).searchParams.get('type') === 'ORDER_DEDUCT' &&
      !!new URL(r.url()).searchParams.get('createdFrom') &&
      !!new URL(r.url()).searchParams.get('createdTo') &&
      new URL(r.url()).searchParams.get('page') === '2',
  );
  await page.getByRole('button', { name: /重\s*试/ }).click();
  await retry;
  // 商品资料保存触发详情刷新时，流水组件及其查询不能被卸载重置。
  await page.getByRole('button', { name: '编辑商品' }).click();
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByPlaceholder('筛选订单号')).toHaveValue('ORD');
  await expect(page.getByTitle('2', { exact: true })).toHaveClass(/active/);
});

for (const scope of [null, 'OWN']) {
  test('无库存权限或非本人OWN商品不展示流水：' + scope, async ({ page }) => {
    await setup(page, scope, 'other-owner');
    await page.goto('/products/' + id);
    await expect(page.getByRole('heading', { name: '流水商品' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '库存流水' })).toHaveCount(0);
  });
}

test('库存实际变化才要求原因并提交trim后的原因与原版本', async ({ page }) => {
  const product = await setup(page);
  let body: Record<string, unknown> | undefined;
  await page.route('**/api/products/' + id, (r) => {
    if (r.request().method() === 'PATCH') {
      body = r.request().postDataJSON();
    }
    return r.fulfill({ json: product });
  });
  await page.goto('/products/' + id);
  await page.getByRole('button', { name: '编辑商品' }).click();
  await page.getByLabel('库存数量').fill('9');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('请输入库存调整原因')).toBeVisible();
  expect(body).toBeUndefined();
  await page.getByLabel('库存调整原因').fill('  盘点补录  ');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(body).toMatchObject({
    stock: 9,
    stockReason: '盘点补录',
    stockVersion: 2,
  });
  body = undefined;
  await page.getByRole('button', { name: '编辑商品' }).click();
  await expect(page.getByLabel('库存调整原因')).toHaveCount(0);
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(body).not.toHaveProperty('stockReason');
});

test('ALL可见其他人商品的空流水，授权订单才有跳转链接', async ({ page }) => {
  await setup(page, 'ALL', 'other-owner');
  let empty = true;
  await page.route('**/api/products/' + id + '/stock-movements?*', (r) =>
    r.fulfill({
      json: {
        list: empty ? [] : [{ ...movement, canViewOrder: true }],
        total: empty ? 0 : 1,
        page: 1,
        pageSize: 10,
      },
    }),
  );
  await page.goto('/products/' + id);
  await expect(page.getByRole('tab', { name: '库存流水' })).toBeVisible();
  await expect(page.getByText('暂无库存流水')).toBeVisible();
  empty = false;
  await page.getByRole('button', { name: '刷新流水' }).click();
  await expect(page.getByRole('link', { name: 'ORD-SAFE' })).toHaveAttribute(
    'href',
    '/orders/restricted-order',
  );
});

test('订单详情显示后端按库存范围裁剪的变动记录', async ({ page }) => {
  await setup(page);
  await page.route('**/api/orders/order-fixture', (r) =>
    r.fulfill({
      json: {
        id: 'order-fixture',
        orderNo: 'ORD-SAFE',
        creatorId: userId,
        status: 'CANCELLED',
        totalAmount: '20.00',
        customerName: '客户',
        phone: '10000',
        address: '地址',
        items: [],
        logs: [],
        createdAt: '2026-01-01T00:00:00Z',
      },
    }),
  );
  await page.route('**/api/orders/order-fixture/stock-movements?*', (r) =>
    r.fulfill({
      json: {
        list: [
          {
            ...movement,
            type: 'ORDER_CANCEL',
            quantityChange: 2,
            beforeStock: 8,
            afterStock: 10,
            reason: '取消回补',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
    }),
  );
  await page.goto('/orders/order-fixture');
  await expect(page.getByText('库存变动', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: '+2', exact: true }),
  ).toBeVisible();
});
