import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const rolePermissions = {
  VIEWER: ['product:read', 'category:read'],
  OPERATOR: [
    'product:read',
    'product:create',
    'product:update',
    'product:delete',
    'category:read',
    'upload:image',
  ],
  ADMIN: [
    'product:read',
    'product:create',
    'product:update',
    'product:delete',
    'category:read',
    'category:create',
    'category:update',
    'category:delete',
    'upload:image',
    'user:read',
    'user:assign-role',
  ],
};
async function setup(page: Page, role: keyof typeof rolePermissions) {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'current_user',
    email: 'current@example.invalid',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    role,
    permissions: rolePermissions[role],
  };
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'rbac-ui-session'),
  );
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: user }));
  await page.route('**/api/categories?*', (r) =>
    r.fulfill({
      json: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
    }),
  );
  const product = {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Permission product',
    description: '',
    price: '10.00',
    stock: 5,
    coverImage: null,
    userId: user.id,
    categoryId: '00000000-0000-4000-8000-000000000002',
    category: {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Shared category',
    },
    user: { id: user.id, username: user.username },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
  await page.route('**/api/products?*', (r) =>
    r.fulfill({
      json: {
        list: [product],
        items: [product],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
        lowStockThreshold: 6,
      },
    }),
  );
  return { user, product };
}
test('viewer has read-only controls and cannot navigate directly to account management', async ({
  page,
}) => {
  await setup(page, 'VIEWER');
  let requests = 0;
  await page.route('**/api/admin/users?*', (r) => {
    requests++;
    return r.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto('/products');
  await expect(
    page.getByText('Permission product', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '新建商品' }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '编辑', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '删除', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: '账号管理' }),
  ).not.toBeVisible();
  await page.goto('/admin/users');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  expect(requests).toBe(0);
});
test('operator can manage owned products but cannot maintain shared categories', async ({
  page,
}) => {
  await setup(page, 'OPERATOR');
  await page.goto('/products');
  await expect(page.getByRole('button', { name: '新建商品' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '编辑', exact: true }),
  ).toBeEnabled();
  await page.getByRole('menuitem', { name: '分类管理' }).click();
  await expect(
    page.getByRole('heading', { name: '分类管理', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '新建分类' }),
  ).not.toBeVisible();
});
test('administrator can edit a foreign product', async ({ page }) => {
  const { product } = await setup(page, 'ADMIN');
  product.userId = '00000000-0000-4000-8000-000000000099';
  product.user.username = 'another_owner';
  await page.route('**/api/products/' + product.id, (r) =>
    r.fulfill({ json: product }),
  );
  await page.goto('/products');
  await expect(page.getByText('another_owner', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '编辑', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: '删除', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: '账号管理' })).toBeVisible();
  await page.getByRole('link', { name: '详情', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑商品' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '删除商品' })).toBeEnabled();
});
test('administrator filters accounts and confirms role changes with loading feedback', async ({
  page,
}) => {
  const { user } = await setup(page, 'ADMIN');
  let targetRole = 'OPERATOR',
    changes = 0;
  const target = {
    ...user,
    id: '00000000-0000-4000-8000-000000000010',
    username: 'target_operator',
  };
  await page.route('**/api/admin/users?*', (r) =>
    r.fulfill({
      json: {
        items: [user, { ...target, role: targetRole }],
        total: 2,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      },
    }),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/users/*/role', async (r) => {
    changes++;
    expect(r.request().postDataJSON()).toEqual({ role: 'VIEWER' });
    await pending;
    targetRole = 'VIEWER';
    await r.fulfill({ json: { ...target, role: targetRole } });
  });
  await page.goto('/admin/users');
  await expect(page.getByRole('button', { name: '当前账号' })).toBeDisabled();
  await page.getByRole('button', { name: '调整角色', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: '确认修改并使旧会话失效' }).click();
  await expect(modal.getByText('请选择不同的角色')).toBeVisible();
  expect(changes).toBe(0);
  await modal.getByRole('combobox').click();
  await page.getByRole('option', { name: '访客', exact: true }).click();
  await modal.getByRole('button', { name: '确认修改并使旧会话失效' }).click();
  await expect(
    modal.getByRole('button', { name: '确认修改并使旧会话失效' }),
  ).toHaveClass(/ant-btn-loading/);
  release();
  await expect(modal).not.toBeVisible();
  await expect(page.getByText('角色已更新，该账号需重新登录')).toBeVisible();
  expect(changes).toBe(1);
  const request = page.waitForRequest(
    (r) =>
      r.url().includes('/api/admin/users?') &&
      new URL(r.url()).searchParams.get('role') === 'VIEWER',
  );
  await page.getByRole('combobox', { name: '角色筛选' }).click();
  await page.getByRole('option', { name: '访客', exact: true }).click();
  await request;
});
test('revoked security credentials clear the session and redirect to login', async ({
  page,
}) => {
  await setup(page, 'OPERATOR');
  await page.goto('/products');
  await expect(
    page.getByText('Permission product', { exact: true }),
  ).toBeVisible();
  await page.route('**/api/products?*', (r) =>
    r.fulfill({
      status: 401,
      json: {
        message: '账号安全信息已变更，请重新登录',
        code: 'SESSION_REVOKED',
      },
    }),
  );
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByText('账号安全信息已变更，请重新登录', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem('silk-shop.access-token')),
  ).toBeNull();
});
