import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DatabaseService } from '../../backend/dist/database/database.service.js';

const backendRequire = createRequire(
  new URL('../../backend/package.json', import.meta.url),
);
const { config } = backendRequire('dotenv');
config({
  path: fileURLToPath(new URL('../../backend/.env', import.meta.url)),
  quiet: true,
});
const prefix = `ui_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const password = 'Ui-test-password-123!';
const ownerName = `${prefix}_owner`;
const otherName = `${prefix}_other`;
const fixtureProduct = `${prefix}_shared_product`;
let database: DatabaseService;

async function login(page: Page, username = ownerName) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(
    page.getByRole('heading', { name: '商品管理', exact: true }),
  ).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  database = new DatabaseService();
  await database.$connect();
  let ownerToken = '';
  for (const username of [ownerName, otherName]) {
    const response = await request.post(
      'http://127.0.0.1:3002/api/auth/register',
      {
        data: { username, email: `${username}@example.invalid`, password },
      },
    );
    expect(response.status()).toBe(201);
    const body = await response.json();
    if (username === ownerName) ownerToken = body.accessToken;
  }
  const headers = { Authorization: `Bearer ${ownerToken}` };
  const category = await request.post('http://127.0.0.1:3002/api/categories', {
    headers,
    data: { name: `${prefix}_shared` },
  });
  expect(category.status()).toBe(201);
  const result = await request.post('http://127.0.0.1:3002/api/products', {
    headers,
    data: {
      name: fixtureProduct,
      categoryId: (await category.json()).id,
      price: '45.00',
      stock: 12,
    },
  });
  expect(result.status()).toBe(201);
});

test.afterAll(async () => {
  if (!database) return;
  try {
    const users = await database.user.findMany({
      where: { username: { startsWith: prefix } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    await database.product.deleteMany({ where: { userId: { in: ids } } });
    await database.category.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await database.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await database.$disconnect();
  }
});

test('registers, manages categories/products, restores session and deletes records through the UI', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/products');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: '创建账号', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill(`${prefix}_ui`);
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(`${prefix}_ui@example.invalid`);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(
    page.getByRole('heading', { name: '商品管理', exact: true }),
  ).toBeVisible();

  await page.getByRole('menuitem', { name: '分类管理' }).click();
  await page.getByRole('button', { name: '新建分类' }).click();
  const categoryDialog = page.getByRole('dialog');
  await categoryDialog.getByLabel('分类名称').fill(`${prefix}_category`);
  await categoryDialog.getByRole('button', { name: '创建分类' }).click();
  await expect(categoryDialog).not.toBeVisible();
  let categoryRow = page
    .getByRole('row')
    .filter({ hasText: `${prefix}_category` });
  await categoryRow.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('分类名称')
    .fill(`${prefix}_renamed`);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '保存修改' })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: `${prefix}_renamed` }),
  ).toBeVisible();

  await page.getByRole('menuitem', { name: '商品管理' }).click();
  await page.getByRole('button', { name: '新建商品' }).click();
  const productDialog = page.getByRole('dialog');
  await productDialog.getByLabel('商品名称').fill(`${prefix}_charger`);
  await productDialog.getByRole('combobox', { name: '请选择商品分类' }).click();
  await page.getByText(`${prefix}_renamed`, { exact: true }).last().click();
  await productDialog.getByLabel('价格（元）').fill('129.999');
  await productDialog.getByLabel('库存数量').fill('7');
  await productDialog
    .getByLabel('商品描述')
    .fill('Browser-tested product description');
  await productDialog.getByRole('button', { name: '创建商品' }).click();
  await expect(
    productDialog.getByText('请输入非负金额，最多两位小数'),
  ).toBeVisible();
  await productDialog.getByLabel('价格（元）').fill('129.90');
  await productDialog.getByRole('button', { name: '创建商品' }).click();
  await expect(productDialog).not.toBeVisible();
  await page.getByPlaceholder('搜索商品名称').fill(`${prefix}_charger`);
  await page.getByRole('button', { name: /^搜\s*索$/ }).click();
  const row = page.getByRole('row').filter({ hasText: `${prefix}_charger` });
  await expect(row).toContainText('¥129.90');
  await page.screenshot({
    path: testInfo.outputPath('products-desktop.png'),
    fullPage: true,
  });
  await row.getByRole('link', { name: '详情', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `${prefix}_charger` }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: `${prefix}_charger` }),
  ).toBeVisible();
  await page.getByRole('button', { name: '编辑商品' }).click();
  await page.getByRole('dialog').getByLabel('价格（元）').fill('99.95');
  await page.getByRole('dialog').getByLabel('库存数量').fill('0');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '保存修改' })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('¥99.95', { exact: true })).toBeVisible();

  await page.getByRole('menuitem', { name: '分类管理' }).click();
  categoryRow = page.getByRole('row').filter({ hasText: `${prefix}_renamed` });
  await expect(
    categoryRow.getByRole('button', { name: '删除', exact: true }),
  ).toBeDisabled();
  await page.getByRole('menuitem', { name: '商品管理' }).click();
  const finalRow = page
    .getByRole('row')
    .filter({ hasText: `${prefix}_charger` });
  await finalRow.getByRole('button', { name: '删除', exact: true }).click();
  await page
    .locator('.ant-popconfirm')
    .getByRole('button', { name: /^删\s*除$/ })
    .click();
  await expect(finalRow).not.toBeVisible();
  await page.getByRole('menuitem', { name: '分类管理' }).click();
  categoryRow = page.getByRole('row').filter({ hasText: `${prefix}_renamed` });
  await categoryRow.getByRole('button', { name: '删除', exact: true }).click();
  await page
    .locator('.ant-popconfirm')
    .getByRole('button', { name: /^删\s*除$/ })
    .click();
  await expect(categoryRow).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('validates registration, reports duplicate/login errors and supports mobile navigation/logout', async ({
  page,
}, testInfo) => {
  await page.goto('/register');
  await page.getByLabel('用户名', { exact: true }).fill(ownerName);
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(`${ownerName}@example.invalid`);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill('Mismatch-password');
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(page.getByText('两次输入的密码不一致')).toBeVisible();
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(page.getByText('用户名或邮箱已被使用')).toBeVisible();
  await page.getByRole('link', { name: '立即登录', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill(ownerName);
  await page.getByLabel('密码', { exact: true }).fill('Wrong-password-123!');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByText('用户名或密码错误')).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(
    page.getByRole('heading', { name: '商品管理', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '切换导航' }).click();
  await page.getByRole('menuitem', { name: '分类管理' }).click();
  await expect(
    page.getByRole('heading', { name: '分类管理', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '新建分类' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('categories-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/categories');
  await expect(page).toHaveURL(/\/login$/);
});

test('disables foreign product mutations, recovers from network failure and redirects expired sessions', async ({
  page,
}) => {
  await login(page, otherName);
  await page.getByPlaceholder('搜索商品名称').fill(fixtureProduct);
  await page.getByRole('button', { name: /^搜\s*索$/ }).click();
  const row = page.getByRole('row').filter({ hasText: fixtureProduct });
  await expect(
    row.getByRole('button', { name: '编辑', exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole('button', { name: '删除', exact: true }),
  ).toBeDisabled();
  await row.getByRole('link', { name: '详情', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑商品' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '删除商品' })).toBeDisabled();
  await page.getByRole('link', { name: '返回商品列表' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: fixtureProduct }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '刷新', exact: true }),
  ).not.toHaveClass(/ant-btn-loading/);
  await page.route('**/api/products?*', (route) => route.abort(), { times: 1 });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(
    page.getByText('无法连接服务器，请检查网络后重试'),
  ).toBeVisible();
  await page.getByRole('button', { name: /^重\s*试$/ }).click();
  await expect(
    page.getByText('无法连接服务器，请检查网络后重试'),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '刷新', exact: true }),
  ).not.toHaveClass(/ant-btn-loading/);
  await page.route(
    '**/api/products?*',
    (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: '登录令牌无效或已过期' }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('登录已过期，请重新登录。')).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem('silk-shop.access-token')),
  ).toBeNull();
});
