import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
async function session(page: Page, permissions: string[], extra: object = {}) {
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'role-ui-session'),
  );
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      json: {
        id: 'current',
        username: 'role_tester',
        email: 'test@example.invalid',
        role: 'CUSTOM',
        roleId: 'current-role',
        roleName: '自定义角色',
        permissions,
        dataScopes: { 'product:read': 'ALL' },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...extra,
      },
    }),
  );
}
test('role editor submits explicit permissions and scope and reports validation errors', async ({
  page,
}) => {
  await session(page, [
    'role:read',
    'role:create',
    'role:update',
    'role:delete',
  ]);
  let saved: Record<string, unknown> | undefined;
  const role = {
    id: 'target-role',
    code: 'READER',
    name: '商品查看',
    description: '测试',
    enabled: true,
    system: false,
    version: 0,
    userCount: 0,
    grants: [{ permission: 'product:read', scope: 'ALL' }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await page.route('**/api/admin/roles/permissions', (r) =>
    r.fulfill({
      json: [
        {
          code: 'product:read',
          name: '查看商品',
          module: '商品',
          scoped: true,
        },
      ],
    }),
  );
  await page.route('**/api/admin/roles?*', (r) =>
    r.fulfill({
      json: {
        items: saved ? [role] : [],
        total: saved ? 1 : 0,
        page: 1,
        pageSize: 20,
      },
    }),
  );
  await page.route('**/api/admin/roles', async (r) => {
    saved = r.request().postDataJSON();
    await r.fulfill({ status: 201, json: role });
  });
  await page.goto('/admin/roles');
  await page.getByRole('button', { name: '新增角色' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: '保存角色' }).click();
  await expect(modal.getByText('请输入角色编码')).toBeVisible();
  await modal.getByLabel('角色编码', { exact: true }).fill('READER');
  await modal.getByLabel('角色名称', { exact: true }).fill('商品查看');
  await modal.getByRole('checkbox', { name: /查看商品/ }).check();
  await modal.getByRole('combobox', { name: '查看商品数据范围' }).click();
  await page.getByRole('option', { name: '全部数据', exact: true }).click();
  await modal.getByRole('button', { name: '保存角色' }).click();
  await expect(modal).not.toBeVisible();
  expect(saved).toEqual({
    code: 'READER',
    name: '商品查看',
    description: '',
    grants: [{ permission: 'product:read', scope: 'ALL' }],
  });
  await expect(
    page.getByRole('cell', { name: '商品查看', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('角色编码')).toBeDisabled();
});
test('role without resource permissions lands on profile and cannot open protected routes', async ({
  page,
}) => {
  await session(page, []);
  await page.route('**/api/users/me', (r) =>
    r.fulfill({
      json: {
        id: 'current',
        username: 'role_tester',
        email: 'test@example.invalid',
        role: 'CUSTOM',
        roleName: '自定义角色',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    }),
  );
  await page.goto('/');
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('menuitem', { name: '角色管理' })).toHaveCount(0);
  await page.goto('/admin/roles');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
});
test('custom role with ALL write scope can manage foreign products without ADMIN label', async ({
  page,
}) => {
  await session(page, ['product:read', 'product:update'], {
    dataScopes: { 'product:read': 'ALL', 'product:update': 'ALL' },
  });
  const product = {
    id: 'p',
    name: '范围验证商品',
    description: '',
    price: '10.00',
    stock: 1,
    stockVersion: 0,
    userId: 'foreign',
    user: { id: 'foreign', username: 'other' },
    categoryId: 'c',
    category: { id: 'c', name: '分类' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await page.route('**/api/products?*', (r) =>
    r.fulfill({
      json: {
        list: [product],
        items: [product],
        total: 1,
        page: 1,
        pageSize: 10,
        lowStockThreshold: 6,
      },
    }),
  );
  await page.goto('/products');
  await expect(
    page.getByRole('button', { name: '编辑', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: '删除', exact: true }),
  ).toHaveCount(0);
});
