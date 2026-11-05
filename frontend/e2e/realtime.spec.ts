import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
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
const { hash } = backendRequire('bcryptjs');
const { JwtService } = backendRequire('@nestjs/jwt');
import { randomUUID } from 'node:crypto';
import { test, expect, type WebSocketRoute } from '@playwright/test';

test('two authenticated windows merge product events, preserve queries, recover after reconnect and revoke password sessions', async ({
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Realtime-test-123!';
  test.skip(
    process.env.E2E_COMPOSE === '1',
    'Realtime fixtures require the isolated local test database.',
  );
  const database = new DatabaseService();
  await database.$connect();
  const authConfig = readAuthConfig();
  const jwt = new JwtService({
    secret: authConfig.secret,
    signOptions: {
      algorithm: 'HS256',
      expiresIn: authConfig.expiresInSeconds,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
  });
  // Seed only the isolated test DB; don't consume shared registration/login rate limits.
  async function fixture(role: 'ADMIN' | 'OPERATOR') {
    const user = await database.user.create({
      data: {
        username: 'rt_' + role.toLowerCase() + '_' + suffix,
        email: role + suffix + '@example.invalid',
        passwordHash: await hash(password, 12),
        role,
      },
    });
    return {
      user,
      accessToken: (await jwt.signAsync({
        sub: user.id,
        tokenVersion: user.tokenVersion,
      })) as string,
    };
  }
  const admin = await fixture('ADMIN');
  const operator = await fixture('OPERATOR');
  const headers = { Authorization: 'Bearer ' + admin.accessToken };
  const categoryResponse = await request.post('/api/categories', {
    headers,
    data: { name: 'Realtime category ' + suffix },
  });
  expect(categoryResponse.status()).toBe(201);
  const category = (await categoryResponse.json()) as { id: string };
  const ids: string[] = [];
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  contexts.forEach((context) => context.setDefaultTimeout(10000));
  try {
    // Twelve matching rows keep page two meaningful while its total changes.
    for (let index = 0; index < 12; index++) {
      const created = await request.post('/api/products', {
        headers,
        data: {
          name: 'RT-' + suffix + '-' + index,
          categoryId: category.id,
          price: String(10 + index),
          stock: 3,
          description: '',
        },
      });
      expect(created.status()).toBe(201);
      ids.push(((await created.json()) as { id: string }).id);
    }
    for (const [index, context] of contexts.entries())
      await context.addInitScript(
        (token) => sessionStorage.setItem('silk-shop.access-token', token),
        [admin, operator][index].accessToken,
      );
    const transports: WebSocketRoute[] = [];
    await contexts[1].routeWebSocket('**/socket.io/**', (socket) => {
      socket.connectToServer();
      transports.push(socket);
    });
    const [a, b] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    const query =
      '?page=2&pageSize=10&name=RT-' +
      suffix +
      '&categoryId=' +
      category.id +
      '&minPrice=1&maxPrice=100&stockStatus=low&sortBy=price&sortOrder=asc';
    const requests: string[] = [];
    b.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/products')
        requests.push(request.url());
    });
    await Promise.all([
      a.goto('/products' + query),
      b.goto('/products' + query),
    ]);
    await expect(
      a.getByLabel('实时连接：已连接', { exact: true }),
    ).toBeVisible();
    await expect(
      b.getByLabel('实时连接：已连接', { exact: true }),
    ).toBeVisible();
    await expect(b.getByText('12 件商品', { exact: true })).toBeVisible();
    await expect(
      b.getByRole('button', { name: '编辑', exact: true }),
    ).toHaveCount(0);
    await b.waitForTimeout(700);
    requests.length = 0;
    const burstStarted = Date.now();
    // HTTP writes exercise the real Nest gateway, proxy and client hook.
    const updates = await Promise.all(
      ids
        .slice(0, 3)
        .map((id) =>
          request.patch('/api/products/' + id, { headers, data: { stock: 4 } }),
        ),
    );
    updates.forEach((response) => expect(response.status()).toBe(200));
    await expect.poll(() => requests.length).toBe(1);
    expect(Date.now() - burstStarted).toBeGreaterThanOrEqual(290);
    await b.waitForTimeout(450);
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(new URL(requests[0]).searchParams)).toEqual(
      Object.fromEntries(new URL(b.url()).searchParams),
    );
    // Open a form, then a remote change must not replace unsaved input.
    await a.getByRole('button', { name: '编辑', exact: true }).first().click();
    await a
      .getByLabel('商品名称', { exact: true })
      .last()
      .fill('Unsaved local draft');
    const remote = await request.patch('/api/products/' + ids[10], {
      headers,
      data: { stock: 5 },
    });
    expect(remote.status()).toBe(200);
    await expect(a.getByText(/数据可能已变化/)).toBeVisible();
    await expect(a.getByLabel('商品名称', { exact: true }).last()).toHaveValue(
      'Unsaved local draft',
    );
    await a.getByRole('button', { name: /^取\s*消$/ }).click();
    // Tear down the upgraded WebSocket without touching either business server.
    await expect.poll(() => transports.length).toBeGreaterThan(0);
    requests.length = 0;
    const recovered = b.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/products' &&
        response.status() === 200,
    );
    transports.at(-1)!.close({ code: 1012, reason: 'isolated reconnect test' });
    await expect(b.getByLabel(/实时连接：(中断|连接中)/)).toBeVisible();
    await expect(
      b.getByLabel('实时连接：已连接', { exact: true }),
    ).toBeVisible();
    await recovered;
    expect(Object.fromEntries(new URL(requests.at(-1)!).searchParams)).toEqual(
      Object.fromEntries(new URL(b.url()).searchParams),
    );
    const forbidden = await request.patch('/api/products/' + ids[0], {
      headers: { Authorization: 'Bearer ' + operator.accessToken },
      data: { stock: 5 },
    });
    expect(forbidden.status()).toBe(404);
    const changed = await request.patch('/api/users/me/password', {
      headers: { Authorization: 'Bearer ' + operator.accessToken },
      data: { oldPassword: password, newPassword: 'Realtime-next-456!' },
    });
    expect(changed.status()).toBe(200);
    await expect(b).toHaveURL(/\/login/);
    await expect(
      b.getByText('密码已修改，请重新登录', { exact: true }),
    ).toBeVisible();
    await expect(
      a.getByLabel('实时连接：已连接', { exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    for (const id of ids)
      await request
        .delete('/api/products/' + id, { headers })
        .catch(() => undefined);
    await request
      .delete('/api/categories/' + category.id, { headers })
      .catch(() => undefined);
    try {
      await database.user.deleteMany({
        where: { id: { in: [admin.user.id, operator.user.id] } },
      });
    } finally {
      await database.$disconnect();
    }
  }
});
