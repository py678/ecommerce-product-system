import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { DatabaseService } from '../../backend/dist/database/database.service.js';
import {
  JWT_ISSUER,
  JWT_AUDIENCE,
  readAuthConfig,
} from '../../backend/dist/auth/auth.config.js';
const backendRequire = createRequire(
  new URL('../../backend/package.json', import.meta.url),
);
backendRequire('dotenv').config({
  path: fileURLToPath(new URL('../../backend/.env', import.meta.url)),
  quiet: true,
});
const { JwtService } = backendRequire('@nestjs/jwt');

test('orders UI validates, retries idempotently, refreshes another window and respects shipping terminal rules', async ({
  browser,
  request,
}) => {
  test.setTimeout(120000);
  test.skip(process.env.E2E_COMPOSE === '1', 'Use isolated local test DB');
  const db = new DatabaseService();
  await db.$connect();
  const suffix = randomUUID().slice(0, 8);
  const ids: string[] = [];
  const orderIds: string[] = [];
  const config = readAuthConfig();
  const jwt = new JwtService({
    secret: config.secret,
    signOptions: {
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: config.expiresInSeconds,
    },
  });
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  let categoryId = '';
  let productId = '';
  try {
    for (let i = 0; i < 2; i++) {
      const u = await db.user.create({
        data: {
          username: 'order_ui_' + suffix + i,
          email: 'order_ui_' + suffix + i + '@example.invalid',
          passwordHash: 'fixture-only',
          role: 'OPERATOR',
        },
      });
      ids.push(u.id);
    }
    const token = await jwt.signAsync({ sub: ids[0], tokenVersion: 0 });
    const other = await jwt.signAsync({ sub: ids[1], tokenVersion: 0 });
    categoryId = (
      await db.category.create({ data: { name: '订单UI分类' + suffix } })
    ).id;
    productId = (
      await db.product.create({
        data: {
          name: '订单UI商品' + suffix,
          userId: ids[1],
          categoryId,
          price: '12.35',
          stock: 4,
        },
      })
    ).id;
    for (const c of contexts)
      await c.addInitScript(
        (t) => sessionStorage.setItem('silk-shop.access-token', t),
        token,
      );
    const page = await contexts[0].newPage();
    page.setDefaultTimeout(10000);
    const observer = await contexts[1].newPage();
    await observer.goto('/orders?status=PENDING&pageSize=10');
    await expect(
      observer.getByRole('status', { name: '实时连接：已连接' }),
    ).toBeVisible();
    await page.goto('/orders/new');
    await page.getByRole('button', { name: '选择商品', exact: true }).click();
    await page
      .getByRole('searchbox', { name: '搜索可选商品' })
      .fill('订单UI商品' + suffix);
    await page.getByRole('searchbox', { name: '搜索可选商品' }).press('Enter');
    await page
      .getByRole('row')
      .filter({ hasText: '订单UI商品' + suffix })
      .getByRole('button', { name: '加入订单' })
      .click();
    await page.getByRole('button', { name: '完成选择', exact: true }).click();
    await page.getByRole('button', { name: '创建订单并扣减库存' }).click();
    await expect(page.getByText('请输入客户姓名')).toBeVisible();
    await page.getByLabel('客户姓名').fill('浏览器客户' + suffix);
    await page.getByLabel('联系电话').fill('bad');
    await page.getByLabel('收货地址').fill('测试地址');
    await page.getByRole('button', { name: '创建订单并扣减库存' }).click();
    await expect(page.getByText('仅允许数字、空格、+、-和括号')).toBeVisible();
    await page.getByLabel('联系电话').fill('13800000000');
    const keys: string[] = [];
    let first = true;
    await page.route('**/api/orders', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      keys.push(route.request().postDataJSON().idempotencyKey);
      if (first) {
        first = false;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        orderIds.push((await response.json()).id);
        return route.abort('failed');
      }
      await route.continue();
    });
    await page.getByRole('button', { name: '创建订单并扣减库存' }).click();
    await expect(
      page.getByText('无法连接服务器，请检查网络后重试'),
    ).toBeVisible();
    await expect(
      observer.getByRole('cell', { name: '浏览器客户' + suffix, exact: true }),
    ).toBeVisible();
    expect(new URL(observer.url()).searchParams.get('status')).toBe('PENDING');
    await observer.reload();
    await expect(
      observer.getByRole('cell', { name: '浏览器客户' + suffix, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '创建订单并扣减库存' }).click();
    await expect(page).toHaveURL(/\/orders\/[a-f0-9-]+$/);
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
    expect(
      (await db.product.findUnique({ where: { id: productId } }))?.stock,
    ).toBe(3);
    expect(
      (
        await request.get('/api/orders/' + orderIds[0], {
          headers: { Authorization: 'Bearer ' + other },
        })
      ).status(),
    ).toBe(404);
    await page.getByRole('button', { name: '取消订单', exact: true }).click();
    await page.getByRole('button', { name: '确认取消', exact: true }).click();
    await expect(page.getByText('请输入取消原因')).toBeVisible();
    await page.getByLabel('取消原因').fill('录单测试');
    await page.getByRole('button', { name: '确认取消', exact: true }).click();
    await expect(page.getByText('订单已取消，库存已回补。')).toBeVisible();
    await expect(
      observer.getByRole('cell', { name: '浏览器客户' + suffix, exact: true }),
    ).toHaveCount(0);
    expect(
      (await db.product.findUnique({ where: { id: productId } }))?.stock,
    ).toBe(4);
    const created = await request.post('/api/orders', {
      headers: { Authorization: 'Bearer ' + token },
      data: {
        idempotencyKey: randomUUID(),
        customerName: '发货客户',
        phone: '13800000000',
        address: '测试地址',
        items: [{ productId, quantity: 1 }],
      },
    });
    expect(created.status()).toBe(201);
    const shipped = await created.json();
    orderIds.push(shipped.id);
    await page.goto('/orders/' + shipped.id);
    await page.getByRole('button', { name: '确认订单', exact: true }).click();
    await page.getByRole('button', { name: /^确\s*定$/ }).click();
    await page.getByRole('button', { name: '填写物流并发货' }).click();
    await page.getByLabel('物流公司').fill('测试物流');
    await page.getByLabel('运单号').fill('UI001');
    await page.getByRole('button', { name: '确认发货', exact: true }).click();
    await expect(
      page.getByText('已发货订单不允许取消，库存不回补。'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '取消订单', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: '完成订单', exact: true }).click();
    await page.getByRole('button', { name: /^确\s*定$/ }).click();
    await expect(
      page.getByText('已完成', { exact: true }).first(),
    ).toBeVisible();
    expect(
      (await db.product.findUnique({ where: { id: productId } }))?.stock,
    ).toBe(3);
  } finally {
    for (const c of contexts) await c.close();
    await db.order.deleteMany({ where: { creatorId: { in: ids } } });
    if (productId) await db.product.deleteMany({ where: { id: productId } });
    if (categoryId) await db.category.deleteMany({ where: { id: categoryId } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
