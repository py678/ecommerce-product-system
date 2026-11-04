import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from 'pg';

if (process.env.RBAC_ISOLATED_TEST !== '1')
  throw new Error('Explicit RBAC_ISOLATED_TEST=1 is required');

test('two-role migration preserves populated accounts, ownership and audit history, and supports an empty database', async () => {
  const prefix = 'two_role_test_' + randomUUID().replaceAll('-', '');
  const schemas = [prefix + '_old', prefix + '_empty'];
  if (
    !schemas.every((schema) =>
      /^two_role_test_[a-f0-9]{32}_(old|empty)$/.test(schema),
    )
  )
    throw new Error('Unsafe test schema');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const names = (
    await readdir(new URL('../prisma/migrations/', import.meta.url))
  )
    .filter((n) => /^\d/.test(n))
    .sort();
  const latest = '20261104081128_two_roles_admin_registration';
  assert.equal(names.at(-1), latest);
  const sql = async (name: string) =>
    readFile(
      new URL(
        '../prisma/migrations/' + name + '/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
  await client.connect();
  try {
    for (const schema of schemas) {
      await client.query('CREATE SCHEMA "' + schema + '"');
      await client.query('SET search_path TO "' + schema + '"');
      for (const name of names.filter((n) => n !== latest))
        await client.query(await sql(name));
      if (schema.endsWith('_old')) {
        const user = randomUUID(),
          admin = randomUUID(),
          category = randomUUID();
        await client.query(
          "INSERT INTO users(id,username,email,password_hash,role) VALUES ($1,'old_account','old@example.invalid','fixture-hash','VIEWER'),($2,'existing_admin','admin@example.invalid','admin-fixture','ADMIN')",
          [user, admin],
        );
        await client.query(
          "INSERT INTO categories(id,name) VALUES ($1,'test-category')",
          [category],
        );
        await client.query(
          "INSERT INTO products(user_id,category_id,name,price,stock) VALUES ($1,$2,'test-product',12.34,7)",
          [user, category],
        );
        await client.query(
          "INSERT INTO role_audits(actor_id,target_id,from_role,to_role) VALUES ($1,$2,'VIEWER','ADMIN')",
          [admin, user],
        );
        const audits = (await client.query('SELECT * FROM role_audits')).rows;
        const products = (await client.query('SELECT * FROM products')).rows;
        await client.query(await sql(latest));
        assert.deepEqual(
          (await client.query('SELECT * FROM role_audits')).rows,
          audits,
        );
        assert.deepEqual(
          (await client.query('SELECT * FROM products')).rows,
          products,
        );
        assert.deepEqual(
          (
            await client.query(
              'SELECT role,token_version,password_hash FROM users WHERE id=$1',
              [user],
            )
          ).rows[0],
          { role: 'OPERATOR', token_version: 1, password_hash: 'fixture-hash' },
        );
        assert.deepEqual(
          (
            await client.query(
              'SELECT role,token_version,password_hash FROM users WHERE id=$1',
              [admin],
            )
          ).rows[0],
          { role: 'ADMIN', token_version: 0, password_hash: 'admin-fixture' },
        );
      } else await client.query(await sql(latest));
      const roles = (
        await client.query(
          'SELECT unnest(enum_range(NULL::"UserRole"))::text AS role',
        )
      ).rows.map((r) => r.role);
      assert.deepEqual(roles, ['OPERATOR', 'ADMIN']);
      const inserted = await client.query(
        "INSERT INTO users(username,email,password_hash) VALUES ('default_account','default@example.invalid','fixture-hash') RETURNING role,token_version",
      );
      assert.deepEqual(inserted.rows[0], {
        role: 'OPERATOR',
        token_version: 0,
      });
      await assert.rejects(client.query("UPDATE users SET role='VIEWER'"), {
        code: '22P02',
      });
    }
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    for (const schema of schemas) {
      await client.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    }
    await client.end();
  }
});
