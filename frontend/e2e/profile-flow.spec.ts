import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseService } from '../../backend/dist/database/database.service.js';

const backendRequire = createRequire(
  new URL('../../backend/package.json', import.meta.url),
);
backendRequire('dotenv').config({
  path: fileURLToPath(new URL('../../backend/.env', import.meta.url)),
  quiet: true,
});
test('edits email, changes password, rejects old credentials and signs in again', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.E2E_COMPOSE === '1',
    'This flow requires the isolated development test database.',
  );
  const db = new DatabaseService();
  await db.$connect();
  const username = `profile_ui_${randomUUID().slice(0, 8)}`;
  const original = 'Original-password-123!';
  const next = 'Changed-password-456!';
  const { hash } = backendRequire('bcryptjs');
  const user = await db.user.create({
    data: {
      username,
      email: `${username}@example.invalid`,
      passwordHash: await hash(original, 12),
    },
  });
  try {
    await page.goto('/login');
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(original);
    await page.getByRole('button', { name: '登录工作台' }).click();
    await expect(
      page.getByRole('heading', { name: '商品管理', exact: true }),
    ).toBeVisible();
    const old = await page.evaluate(() =>
      sessionStorage.getItem('silk-shop.access-token'),
    );
    await page.getByRole('menuitem', { name: '个人中心' }).click();
    await expect(
      page.getByRole('heading', { name: '个人中心', exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('邮箱地址', { exact: true })
      .fill(`${username}_updated@example.invalid`);
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    await expect(
      page.getByText('个人资料已更新', { exact: true }),
    ).toBeVisible();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).email,
    ).toBe(`${username}_updated@example.invalid`);
    await page.getByLabel('原密码', { exact: true }).fill(original);
    await page.getByLabel('新密码', { exact: true }).fill(next);
    await page.getByLabel('确认新密码', { exact: true }).fill(next);
    await page
      .getByRole('button', { name: '修改密码并重新登录', exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText('密码已修改，请重新登录', { exact: true }),
    ).toBeVisible();
    expect(
      (
        await request.get('http://127.0.0.1:3002/api/products', {
          headers: { Authorization: `Bearer ${old}` },
        })
      ).status(),
    ).toBe(401);
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(next);
    await page.getByRole('button', { name: '登录工作台' }).click();
    await expect(
      page.getByRole('heading', { name: '个人中心', exact: true }),
    ).toBeVisible();
  } finally {
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
