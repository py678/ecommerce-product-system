import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // BCrypt and real PostgreSQL suites are CPU/connection intensive on developer machines.
    // Keep behavior/assertions unchanged while avoiding 15 suites hashing concurrently.
    maxWorkers: 2,
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts', 'test/**/*.spec.ts'],
  },
});
