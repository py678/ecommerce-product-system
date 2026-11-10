import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
async function setup(page: Page, purge = true) {
  const permissions = [
    'user:read',
    'user:delete',
    'user:restore',
    ...(purge ? ['user:purge'] : []),
  ];
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'admin',
    role: purge ? 'ADMIN' : 'SUPPORT',
    roleId: '00000000-0000-4000-8000-000000000010',
    roleName: '管理员',
    permissions,
    dataScopes: {},
    email: 'admin@example.invalid',
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
  };
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'lifecycle-session'),
  );
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: user }));
  await page.route('**/api/admin/roles/options', (r) =>
    r.fulfill({ json: [] }),
  );
  let deleted = false;
  const submissions: { action: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/users**', async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    if (url.pathname.endsWith('/dependencies'))
      return r.fulfill({
        json: { productCount: 0, orderCount: 0, canPurge: true },
      });
    if (req.method() !== 'GET') {
      const action = url.pathname.endsWith('/restore')
        ? 'restore'
        : url.pathname.endsWith('/purge')
          ? 'purge'
          : 'delete';
      submissions.push({ action, body: req.postDataJSON() });
      deleted = action !== 'restore';
      return r.fulfill({ json: { message: 'ok' } });
    }
    const target = {
      ...user,
      id: '00000000-0000-4000-8000-000000000002',
      username: 'test_target',
      role: 'OPERATOR',
      deletedAt: deleted ? '2026-11-10T00:00:00Z' : null,
      deleteReason: deleted ? '离职停用' : null,
    };
    const show = (url.searchParams.get('status') === 'deleted') === deleted;
    return r.fulfill({
      json: {
        items: show ? [target] : [],
        total: show ? 1 : 0,
        page: 1,
        pageSize: 20,
      },
    });
  });
  return submissions;
}
test('soft deletion validates reason, refreshes lists and restores from recycle bin', async ({
  page,
}) => {
  const submissions = await setup(page);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '软删除', exact: true }).click();
  await page.getByRole('button', { name: '确认软删除', exact: true }).click();
  await expect(
    page.getByText('请填写操作原因', { exact: true }).first(),
  ).toBeVisible();
  expect(submissions).toHaveLength(0);
  await page.getByLabel('操作原因').fill('离职停用');
  await page.getByRole('button', { name: '确认软删除', exact: true }).click();
  await expect(
    page.getByText('test_target', { exact: true }),
  ).not.toBeVisible();
  await page.getByRole('tab', { name: '回收站' }).click();
  await expect(page.getByText('test_target', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByLabel('操作原因').fill('重新启用');
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions).toEqual([
    { action: 'delete', body: { reason: '离职停用' } },
    { action: 'restore', body: { reason: '重新启用' } },
  ]);
});
test('purge requires dependency preview and exact username confirmation', async ({
  page,
}) => {
  const submissions = await setup(page);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '软删除', exact: true }).click();
  await page.getByLabel('操作原因').fill('离职停用');
  await page.getByRole('button', { name: '确认软删除', exact: true }).click();
  await page.getByRole('tab', { name: '回收站' }).click();
  await page.getByRole('button', { name: '彻底删除', exact: true }).click();
  await expect(
    page.getByText('商品：0；订单（全部状态）：0', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('确认用户名').fill('wrong_user');
  await page.getByLabel('操作原因').fill('清理空账号');
  await page.getByRole('button', { name: '确认彻底删除', exact: true }).click();
  await expect(
    page.getByText('用户名不匹配', { exact: true }).first(),
  ).toBeVisible();
  expect(submissions).toHaveLength(1);
  await page.getByLabel('确认用户名').fill('test_target');
  await page.getByRole('button', { name: '确认彻底删除', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1]).toEqual({
    action: 'purge',
    body: { username: 'test_target', reason: '清理空账号' },
  });
});
