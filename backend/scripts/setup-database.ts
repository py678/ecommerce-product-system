import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { Client } from 'pg';

// Optional one-time credentials file is ignored and removed after initial setup.
config({ path: '.env.setup.local', quiet: true });
const adminUrl = process.env.POSTGRES_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'POSTGRES_ADMIN_URL is required for one-time database creation.',
  );
if (existsSync('.env'))
  throw new Error(
    '.env already exists; refusing to overwrite local credentials.',
  );

const admin = new Client({ connectionString: adminUrl });
try {
  await admin.connect();
  const existing = await admin.query(
    `SELECT 1 FROM pg_roles WHERE rolname = 'silk_shop_app'
     UNION ALL SELECT 1 FROM pg_database WHERE datname IN ('silk_shop', 'silk_shop_shadow')`,
  );
  if (existing.rowCount)
    throw new Error('Project role/database already exists; no changes made.');
  const password = randomBytes(32).toString('hex');
  // password is generated hexadecimal, never supplied SQL text.
  await admin.query(
    `CREATE ROLE silk_shop_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
  );
  writeFileSync(
    '.env',
    `DATABASE_URL="postgresql://silk_shop_app:${password}@localhost:5432/silk_shop?schema=public"\nSHADOW_DATABASE_URL="postgresql://silk_shop_app:${password}@localhost:5432/silk_shop_shadow?schema=public"\nPORT=3000\nJWT_SECRET="${randomBytes(32).toString('hex')}"\nJWT_EXPIRES_IN_SECONDS=3600\nFRONTEND_ORIGIN="http://localhost:5173"\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await admin.query('CREATE DATABASE silk_shop OWNER silk_shop_app');
  await admin.query('CREATE DATABASE silk_shop_shadow OWNER silk_shop_app');
  await admin.query('REVOKE ALL ON DATABASE silk_shop FROM PUBLIC');
  await admin.query('REVOKE ALL ON DATABASE silk_shop_shadow FROM PUBLIC');
  console.log(
    'Created isolated silk_shop database and non-superuser silk_shop_app; saved local .env.',
  );
} finally {
  await admin.end();
}
