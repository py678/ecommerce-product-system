import { test, expect } from '@playwright/test';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'profile_user',
  role: 'OPERATOR',
  permissions: [
    'product:read',
    'product:create',
    'product:update',
    'product:delete',
    'category:read',
    'upload:image',
  ],
  email: 'profile@example.invalid',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'profile-test-session'),
  );
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: user }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: user }));
});

test('validates profile/password fields and displays field-level API failures', async ({
  page,
}) => {
  let changes = 0;
  await page.route('**/api/users/me/password', (route) => {
    changes++;
    return route.fulfill({ status: 400, json: { message: '原密码错误' } });
  });
  await page.goto('/profile');
  await expect(page.getByLabel('邮箱地址', { exact: true })).toHaveValue(
    user.email,
  );
  await page.getByLabel('邮箱地址', { exact: true }).fill('invalid');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByText('请输入有效邮箱')).toBeVisible();
  await page
    .getByLabel('原密码', { exact: true })
    .fill('Original-password-123!');
  await page.getByLabel('新密码', { exact: true }).fill('abcdefgh');
  await page.getByLabel('确认新密码', { exact: true }).fill('abcdefgh');
  await page
    .getByRole('button', { name: '修改密码并重新登录', exact: true })
    .click();
  await expect(page.getByText('新密码至少包含英文字母和数字')).toBeVisible();
  expect(changes).toBe(0);
  await page
    .getByLabel('新密码', { exact: true })
    .fill('Original-password-123!');
  await expect(page.getByText('新密码不得与原密码相同')).toBeVisible();
  await page
    .getByLabel('新密码', { exact: true })
    .fill('Changed-password-456!');
  await page
    .getByLabel('确认新密码', { exact: true })
    .fill('Different-password-789!');
  await page
    .getByRole('button', { name: '修改密码并重新登录', exact: true })
    .click();
  await expect(page.getByText('两次输入的新密码不一致')).toBeVisible();
  expect(changes).toBe(0);
  await page
    .getByLabel('确认新密码', { exact: true })
    .fill('Changed-password-456!');
  await page
    .getByRole('button', { name: '修改密码并重新登录', exact: true })
    .click();
  await expect(page.getByText('原密码错误', { exact: true })).toBeVisible();
  expect(changes).toBe(1);
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue(
    'Changed-password-456!',
  );
  await page.route('**/api/users/me', (route) =>
    route.fulfill({ status: 409, json: { message: '邮箱已被使用' } }),
  );
  await page
    .getByLabel('邮箱地址', { exact: true })
    .fill('taken@example.invalid');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByText('邮箱已被使用', { exact: true })).toBeVisible();
});

for (const status of [200, 401])
  test(`clears the session and redirects with password-change notice on ${status}`, async ({
    page,
  }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/users/me/password', async (route) => {
      await pending;
      await route.fulfill({
        status,
        json: { message: '密码已修改，请重新登录' },
      });
    });
    await page.goto('/profile');
    await page
      .getByLabel('原密码', { exact: true })
      .fill('Original-password-123!');
    await page
      .getByLabel('新密码', { exact: true })
      .fill('Changed-password-456!');
    await page
      .getByLabel('确认新密码', { exact: true })
      .fill('Changed-password-456!');
    await page
      .getByRole('button', { name: '修改密码并重新登录', exact: true })
      .click();
    await expect(
      page
        .locator('button.ant-btn-loading')
        .filter({ hasText: '修改密码并重新登录' }),
    ).toBeVisible();
    await expect(page.getByLabel('新密码', { exact: true })).toBeDisabled();
    release();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText('密码已修改，请重新登录', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('silk-shop.access-token'),
      ),
    ).toBeNull();
  });
