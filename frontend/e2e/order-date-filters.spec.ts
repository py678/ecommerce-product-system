import { expect, test, type Page } from '@playwright/test';

test.use({ timezoneId: 'Asia/Shanghai' });

async function fixture(page: Page) {
  const queries: URLSearchParams[] = [];
  await page.clock.setFixedTime(new Date('2026-11-13T12:00:00+08:00'));
  await page.addInitScript(() =>
    sessionStorage.setItem('silk-shop.access-token', 'mock-date-session'),
  );
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me')
      return route.fulfill({
        json: {
          id: 'date-user',
          username: 'date_user',
          email: 'date@example.invalid',
          role: 'OPERATOR',
          roleName: '运营人员',
          permissions: ['order:read'],
          dataScopes: { 'order:read': 'OWN' },
        },
      });
    if (url.pathname === '/api/orders') {
      queries.push(url.searchParams);
      return route.fulfill({
        json: {
          list: [],
          total: 0,
          page: Number(url.searchParams.get('page') || 1),
          pageSize: 10,
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { message: 'Unconfigured mock' },
    });
  });
  return queries;
}

test('today and week combine search/status, reset page and survive reload/history', async ({
  page,
}) => {
  const queries = await fixture(page);
  await page.goto('/orders?search=ORD-test&status=PENDING&page=3');
  await page.getByRole('button', { name: /^今\s*天$/ }).click();
  await expect
    .poll(() => queries.at(-1)?.get('createdFrom'))
    .toBe('2026-11-12T16:00:00.000Z');
  expect(queries.at(-1)?.get('createdTo')).toBe('2026-11-13T15:59:59.999Z');
  expect(queries.at(-1)?.get('page')).toBe('1');
  expect(queries.at(-1)?.get('search')).toBe('ORD-test');
  expect(queries.at(-1)?.get('status')).toBe('PENDING');
  await page.getByRole('button', { name: /^本\s*周$/ }).click();
  await expect
    .poll(() => queries.at(-1)?.get('createdFrom'))
    .toBe('2026-11-08T16:00:00.000Z');
  expect(queries.at(-1)?.get('createdTo')).toBe('2026-11-15T15:59:59.999Z');
  await page.reload();
  await expect(page.getByLabel('开始日期', { exact: true })).toHaveValue(
    '2026-11-09',
  );
  await expect(page.getByLabel('结束日期', { exact: true })).toHaveValue(
    '2026-11-15',
  );
  await page.goBack();
  await expect(page.getByLabel('开始日期', { exact: true })).toHaveValue(
    '2026-11-13',
  );
  await page.getByRole('button', { name: /^重\s*置$/ }).click();
  await expect.poll(() => queries.at(-1)?.has('createdFrom')).toBe(false);
  expect(queries.at(-1)?.has('status')).toBe(false);
});

test('custom inclusive dates support single boundary and reject reversed range without request', async ({
  page,
}) => {
  const queries = await fixture(page);
  await page.goto('/orders');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-10-31');
  await expect
    .poll(() => queries.at(-1)?.get('createdFrom'))
    .toBe('2026-10-30T16:00:00.000Z');
  expect(queries.at(-1)?.has('createdTo')).toBe(false);
  await page.getByLabel('结束日期', { exact: true }).fill('2026-11-01');
  await expect
    .poll(() => queries.at(-1)?.get('createdTo'))
    .toBe('2026-11-01T15:59:59.999Z');
  const count = queries.length;
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-30');
  await expect(page.getByRole('alert')).toContainText(
    '开始日期不能晚于结束日期',
  );
  expect(queries.length).toBe(count);
  await page.getByLabel('开始日期', { exact: true }).fill('');
  await expect.poll(() => queries.at(-1)?.has('createdFrom')).toBe(false);
  expect(queries.at(-1)?.get('createdTo')).toBe('2026-10-30T15:59:59.999Z');
});

test('week starts Monday even on Sunday and spans calendar months', async ({
  page,
}) => {
  const queries = await fixture(page);
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00+08:00'));
  await page.goto('/orders');
  await page.getByRole('button', { name: /^本\s*周$/ }).click();
  await expect
    .poll(() => queries.at(-1)?.get('createdFrom'))
    .toBe('2026-10-25T16:00:00.000Z');
  expect(queries.at(-1)?.get('createdTo')).toBe('2026-11-01T15:59:59.999Z');
});

test('Monday week shortcut includes the same Monday and explicit refresh retains dates', async ({
  page,
}) => {
  const queries = await fixture(page);
  await page.clock.setFixedTime(new Date('2026-11-09T12:00:00+08:00'));
  await page.goto('/orders?status=CONFIRMED');
  await page.getByRole('button', { name: /^本\s*周$/ }).click();
  await expect
    .poll(() => queries.at(-1)?.get('createdFrom'))
    .toBe('2026-11-08T16:00:00.000Z');
  const before = queries.length;
  await page.getByRole('button', { name: /刷新/ }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(before);
  expect(queries.at(-1)?.get('createdTo')).toBe('2026-11-15T15:59:59.999Z');
  expect(queries.at(-1)?.get('status')).toBe('CONFIRMED');
});
