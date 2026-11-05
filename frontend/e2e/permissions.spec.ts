import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const rolePermissions = {
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
  await page.route('**/socket.io/**', (route) => route.abort());
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
  await page.goto('/admin/users');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
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
    expect(r.request().postDataJSON()).toEqual({ role: 'ADMIN' });
    await pending;
    targetRole = 'ADMIN';
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
  await page.getByRole('option', { name: '管理员', exact: true }).click();
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
      new URL(r.url()).searchParams.get('role') === 'ADMIN',
  );
  await page.getByRole('combobox', { name: '角色筛选' }).click();
  await page.getByRole('option', { name: '管理员', exact: true }).click();
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

for (const role of ['OPERATOR'] as const) {
  test(
    role + ' can view a foreign product but has no edit/delete actions',
    async ({ page }) => {
      const { product } = await setup(page, role);
      product.userId = '00000000-0000-4000-8000-000000000099';
      product.user.username = 'foreign_owner';
      await page.route('**/api/products/' + product.id, (r) =>
        r.fulfill({ json: product }),
      );
      await page.goto('/products');
      await expect(
        page.getByText('foreign_owner', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: '编辑', exact: true }),
      ).not.toBeVisible();
      await expect(
        page.getByRole('button', { name: '删除', exact: true }),
      ).not.toBeVisible();
      await page.getByRole('link', { name: '详情', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: product.name, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: '编辑商品', exact: true }),
      ).not.toBeVisible();
      await expect(
        page.getByRole('button', { name: '删除商品', exact: true }),
      ).not.toBeVisible();
    },
  );
}
for (const [role, label] of Object.entries({
  OPERATOR: '运营人员',
  ADMIN: '管理员',
})) {
  test(
    label + ' login entrance submits a role check and reports mismatch',
    async ({ page }) => {
      await page.route('**/api/auth/login', async (r) => {
        expect(r.request().postDataJSON()).toEqual({
          username: 'example_user',
          password: 'Example-password-123!',
          loginRole: role,
        });
        await r.fulfill({
          status: 401,
          json: { message: '账号角色与所选登录入口不匹配，请选择正确入口' },
        });
      });
      await page.goto('/login');
      await page.getByText(label, { exact: true }).click();
      await page.getByLabel('用户名', { exact: true }).fill('example_user');
      await page
        .getByLabel('密码', { exact: true })
        .fill('Example-password-123!');
      await page.getByRole('button', { name: '登录工作台' }).click();
      await expect(
        page.getByText('账号角色与所选登录入口不匹配，请选择正确入口', {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('silk-shop.access-token'),
        ),
      ).toBeNull();
      await expect(page.getByLabel('用户名', { exact: true })).toHaveValue(
        'example_user',
      );
    },
  );
}

test('administrator registration requires a company identifier and preserves fields on rejection', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/auth/register', async (r) => {
    requests++;
    expect(r.request().postDataJSON()).toEqual({
      username: 'new_admin',
      email: 'new-admin@example.invalid',
      password: 'Example-password-123!',
      role: 'ADMIN',
      companyId: 'wrong-company',
    });
    await r.fulfill({ status: 400, json: { message: '公司内部 ID 不正确' } });
  });
  await page.goto('/register');
  await expect(page.getByText('访客', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('公司内部 ID', { exact: true })).toHaveCount(0);
  await page.getByText('管理员', { exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill('new_admin');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill('new-admin@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('Example-password-123!');
  await page
    .getByLabel('确认密码', { exact: true })
    .fill('Example-password-123!');
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(
    page.getByText('请输入公司内部 ID', { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(0);
  await page.getByLabel('公司内部 ID', { exact: true }).fill('wrong-company');
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(
    page.getByText('公司内部 ID 不正确', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue(
    'new_admin',
  );
  expect(
    await page.evaluate(() => sessionStorage.getItem('silk-shop.access-token')),
  ).toBeNull();
  await page.getByText('运营人员', { exact: true }).click();
  await expect(page.getByLabel('公司内部 ID', { exact: true })).toHaveCount(0);
});
test('operator registration omits a company identifier after switching roles', async ({
  page,
}) => {
  await page.route('**/api/auth/register', async (r) => {
    expect(r.request().postDataJSON()).toEqual({
      username: 'new_operator',
      email: 'new-operator@example.invalid',
      password: 'Example-password-123!',
      role: 'OPERATOR',
    });
    await r.fulfill({ status: 409, json: { message: '用户名或邮箱已被使用' } });
  });
  await page.goto('/register');
  await page.getByText('管理员', { exact: true }).click();
  await page
    .getByLabel('公司内部 ID', { exact: true })
    .fill('must-not-be-submitted');
  await page.getByText('运营人员', { exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill('new_operator');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill('new-operator@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('Example-password-123!');
  await page
    .getByLabel('确认密码', { exact: true })
    .fill('Example-password-123!');
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(
    page.getByText('用户名或邮箱已被使用', { exact: true }),
  ).toBeVisible();
});
