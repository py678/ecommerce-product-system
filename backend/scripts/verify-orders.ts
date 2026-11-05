import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';

// A throwaway schema keeps browser fixtures out of both synchronized business DBs.
const backend = fileURLToPath(new URL('../', import.meta.url));
const frontend = resolve(backend, '../frontend');
config({ path: resolve(backend, '.env'), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Configure backend/.env DATABASE_URL first');
const schema = 'orders_test_' + randomUUID().replaceAll('-', '');
const isolated = new URL(databaseUrl);
isolated.searchParams.set('schema', schema);
const env = { ...process.env, DATABASE_URL: isolated.toString() };
delete env.E2E_COMPOSE;
const client = new Client({ connectionString: databaseUrl });
function run(cwd: string, file: string, args: string[]) {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd,
      env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error('Orders verification failed: exit ' + code)),
    );
  });
}
await client.connect();
let created = false;
try {
  await client.query('CREATE SCHEMA "' + schema + '"');
  created = true;
  await run(backend, 'node_modules/prisma/build/index.js', [
    'migrate',
    'deploy',
  ]);
  await run(backend, 'node_modules/prisma/build/index.js', [
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema=prisma/schema.prisma',
    '--exit-code',
  ]);
  await run(backend, '--test', ['scripts/database.integration.test.ts']);
  if (!process.argv.includes('--database-only'))
    await run(backend, 'node_modules/vitest/vitest.mjs', [
      'run',
      '--config',
      'vitest.config.e2e.ts',
      ...(process.argv.includes('--all') ? [] : ['test/orders.e2e-spec.ts']),
    ]);
  if (process.argv.includes('--browser'))
    await run(frontend, 'node_modules/@playwright/test/cli.js', [
      'test',
      ...(process.argv.includes('--all') ? [] : ['orders.spec.ts']),
    ]);
} finally {
  try {
    // Only delete the random namespace this invocation created, never public or a supplied identifier.
    if (created && /^orders_test_[a-f0-9]{32}$/.test(schema))
      await client.query('DROP SCHEMA "' + schema + '" CASCADE');
  } finally {
    await client.end();
  }
}
