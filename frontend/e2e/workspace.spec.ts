import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
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
const compose = process.env.E2E_COMPOSE === '1';
test.skip(compose, 'Role fixtures require an isolated local test database.');
const apiBase = compose
  ? `${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8088'}/api`
  : 'http://127.0.0.1:3002/api';
let database: DatabaseService;
const uploadedPaths: string[] = [];

async function login(page: Page, username = ownerName) {
  await page.goto('/login');
  await page
    .getByText(username === ownerName ? '管理员' : '运营人员', { exact: true })
    .click();
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(
    page.getByRole('heading', { name: '商品管理', exact: true }),
  ).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  if (!compose) {
    database = new DatabaseService();
    await database.$connect();
  }
  let ownerToken = '';
  for (const username of [ownerName, otherName]) {
    const response = await request.post(`${apiBase}/auth/register`, {
      data: { username, email: `${username}@example.invalid`, password },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    await database.user.update({
      where: { id: body.user.id },
      data: { role: username === ownerName ? 'ADMIN' : 'OPERATOR' },
    });
    if (username === ownerName) ownerToken = body.accessToken;
  }
  const headers = { Authorization: `Bearer ${ownerToken}` };
  const category = await request.post(`${apiBase}/categories`, {
    headers,
    data: { name: `${prefix}_shared` },
  });
  expect(category.status()).toBe(201);
  const result = await request.post(`${apiBase}/products`, {
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
  await Promise.all(
    uploadedPaths.map((url) =>
      unlink(
        fileURLToPath(new URL(`../../backend${url}`, import.meta.url)),
      ).catch(() => {}),
    ),
  );
  if (compose) {
    await promisify(execFile)(
      process.env.DOCKER_EXECUTABLE ?? 'docker',
      [
        'compose',
        '-p',
        process.env.E2E_COMPOSE_PROJECT ?? 'silk-shop',
        'run',
        '--rm',
        '--no-deps',
        'migrate',
        'node',
        'scripts/cleanup-browser-fixtures.ts',
        prefix,
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        timeout: 60000,
      },
    );
    return;
  }
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

test('registers a viewer, then manages categories/products as an administrator', async ({
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

  await expect(
    page.getByRole('button', { name: '新建商品' }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await login(page);
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
  await page.getByText('管理员', { exact: true }).click();
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

test('shares foreign products read-only, recovers from network failure and redirects expired sessions', async ({
  page,
}) => {
  await login(page, otherName);
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/products' &&
      url.searchParams.get('name') === fixtureProduct &&
      response.status() === 200
    );
  });
  await page.getByPlaceholder('搜索商品名称').fill(fixtureProduct);
  await page.getByRole('button', { name: /^搜\s*索$/ }).click();
  await filtered;
  await expect(
    page.getByRole('row').filter({ hasText: fixtureProduct }),
  ).toBeVisible();
  const foreignRow = page.getByRole('row').filter({ hasText: fixtureProduct });
  await expect(
    foreignRow.getByRole('button', { name: '编辑', exact: true }),
  ).not.toBeVisible();
  await expect(
    foreignRow.getByRole('button', { name: '删除', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '刷新', exact: true }),
  ).not.toHaveClass(/ant-btn-loading/);
  await page.route('**/api/products?*', (route) => route.abort(), { times: 1 });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(
    page.getByText('无法连接服务器，请检查网络后重试'),
  ).toBeVisible();
  const retried = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/products' &&
      response.status() === 200,
  );
  await page.getByRole('button', { name: /^重\s*试$/ }).click();
  await retried;
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

test('uploads a cover with feedback, saves and previews it, then clears it without deleting the file', async ({
  page,
  request,
}) => {
  await login(page);
  await page.getByRole('button', { name: '新建商品' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('商品名称').fill(`${prefix}_cover`);
  await dialog.getByRole('combobox', { name: '请选择商品分类' }).click();
  await page.getByText(`${prefix}_shared`, { exact: true }).last().click();
  await dialog.getByLabel('价格（元）').fill('12.34');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1sAAAAASUVORK5CYII=',
    'base64',
  );
  const input = dialog.locator('input[type=file]');
  await input.setInputFiles({
    name: 'bad.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(
    page.getByText('仅支持 JPG、JPEG、PNG、WEBP 图片', { exact: true }),
  ).toBeVisible();
  await page.route(
    '**/api/upload/image',
    (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '测试上传失败' }),
      }),
    { times: 1 },
  );
  await input.setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByText('测试上传失败', { exact: true })).toBeVisible();
  await page.route(
    '**/api/upload/image',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    },
    { times: 1 },
  );
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/upload/image') && response.status() === 200,
  );
  await input.setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(dialog.getByRole('button', { name: '创建商品' })).toBeDisabled();
  const url = (await (await uploaded).json()).data.url as string;
  uploadedPaths.push(url);
  await expect(
    dialog.locator('.ant-upload-list-item-thumbnail img'),
  ).toHaveAttribute('src', url);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/products') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '创建商品' }).click();
  const product = await (await saved).json();
  expect(product.coverImage).toBe(url);
  await expect(dialog).not.toBeVisible();
  await page.goto(`/products/${product.id}`);
  await page.getByRole('button', { name: '编辑商品' }).click();
  await expect(
    dialog.locator('.ant-upload-list-item-thumbnail img'),
  ).toHaveAttribute('src', url);
  await dialog.locator('.ant-upload-list-item-actions a').click();
  await expect(page.getByAltText('商品封面预览')).toBeVisible();
  await page
    .getByRole('dialog')
    .filter({ hasText: '商品封面' })
    .last()
    .getByRole('button', { name: /Close|关闭/ })
    .click();
  await dialog.locator('.ant-upload-list-item-actions button').click();
  const cleared = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/products/${product.id}`) &&
      response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: '保存修改' }).click();
  expect((await (await cleared).json()).coverImage).toBeNull();
  const image = await request.get(url);
  expect(image.status()).toBe(200);
  expect(await image.body()).toEqual(png);
});
