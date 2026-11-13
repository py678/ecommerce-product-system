import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, empty = false, adminLabel = false) {
  const writes: string[] = [];
  const user = {
    id: 'profile-permission-user',
    username: 'profile_user',
    email: 'profile@example.invalid',
    role: adminLabel ? 'ADMIN' : 'SUPPORT',
    roleId: 'test-role',
    roleName: adminLabel ? '管理员' : '客服运营',
    permissions: empty
      ? []
      : [
          'product:read',
          'product:create',
          'product:update',
          'order:read',
          'category:read',
        ],
    dataScopes: {
      'product:read': 'ALL',
      'product:update': 'OWN',
      'order:read': 'OWN',
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'silk-shop.access-token',
      'mock-profile-permissions',
    ),
  );
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me' || pathname === '/api/users/me')
      return route.fulfill({ json: user });
    return route.fulfill({
      status: 404,
      json: { message: 'Unconfigured mock' },
    });
  });
  return writes;
}

test('profile displays actual role and per-action scopes without editable controls', async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto('/profile');
  const region = page.getByRole('region', { name: '角色与权限' });
  await expect(region).toBeVisible();
  await expect(region.getByText('客服运营', { exact: true })).toBeVisible();
  await expect(region.getByText('SUPPORT', { exact: true })).toBeVisible();
  await expect(
    region.getByText('查看商品：全部数据', { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByText('修改商品：仅本人', { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByText('查看订单：仅本人', { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByText('创建商品：创建后归本人', { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByText('查看分类：全局共享', { exact: true }),
  ).toBeVisible();
  await expect(region.getByRole('checkbox')).toHaveCount(0);
  await expect(region.getByRole('combobox')).toHaveCount(0);
  await expect(region.getByRole('button')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('role with no grants keeps profile access and displays empty permission guidance', async ({
  page,
}) => {
  await fixture(page, true);
  await page.goto('/profile');
  const region = page.getByRole('region', { name: '角色与权限' });
  await expect(
    region.getByText('当前角色未授予业务权限，可使用个人中心。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('邮箱地址')).toBeVisible();
});

test('administrator label does not invent permissions absent from the session', async ({
  page,
}) => {
  await fixture(page, false, true);
  await page.goto('/profile');
  const region = page.getByRole('region', { name: '角色与权限' });
  await expect(region.getByText('管理员', { exact: true })).toBeVisible();
  await expect(
    region.getByText('修改商品：仅本人', { exact: true }),
  ).toBeVisible();
  await expect(region.getByText(/删除商品/)).toHaveCount(0);
});
