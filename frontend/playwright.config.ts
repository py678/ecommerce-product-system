import { defineConfig, devices } from '@playwright/test';

const compose = process.env.E2E_COMPOSE === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: compose
      ? (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8088')
      : 'http://127.0.0.1:5174',
    ...devices['Desktop Edge'],
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: compose
    ? undefined
    : [
        {
          command:
            'npm.cmd --prefix ../backend run build && npm.cmd --prefix ../backend run start:prod',
          url: 'http://127.0.0.1:3002/docs',
          reuseExistingServer: false,
          env: { PORT: '3002' },
          timeout: 120000,
        },
        {
          command:
            'npm.cmd run build && npm.cmd run preview -- --host 127.0.0.1 --port 5174 --strictPort',
          url: 'http://127.0.0.1:5174',
          reuseExistingServer: false,
          env: { DEV_API_TARGET: 'http://127.0.0.1:3002' },
          timeout: 60000,
        },
      ],
});
