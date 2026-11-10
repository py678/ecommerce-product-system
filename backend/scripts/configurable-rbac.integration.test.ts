import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from 'pg';
import { syncDirection, applyChange } from './sync/bridge.ts';

if (process.env.RBAC_ISOLATED_TEST !== '1')
  throw new Error('Requires RBAC_ISOLATED_TEST=1');
test('configurable roles preserve upgrade data and replicate role/grants/revocation atomically', async () => {
  const prefix = 'roles_sync_' + randomUUID().replaceAll('-', '');
  const schemas = [prefix + '_a', prefix + '_b'];
  const clients = schemas.map(
    () => new Client({ connectionString: process.env.DATABASE_URL }),
  );
  const admin = randomUUID(),
    operator = randomUUID(),
    cat = randomUUID(),
    product = randomUUID(),
    role = randomUUID();
  const migrations = (
    await readdir(new URL('../prisma/migrations/', import.meta.url))
  )
    .filter((n) => /^\d/.test(n))
    .sort();
  try {
    for (const [i, db] of clients.entries()) {
      await db.connect();
      await db.query('CREATE SCHEMA "' + schemas[i] + '"');
      await db.query('SET search_path TO "' + schemas[i] + '"');
      await db.query("SET TIME ZONE 'UTC'");
      for (const migration of migrations.filter(
        (n) => n < '20261110023925_configurable_rbac',
      ))
        await db.query(
          await readFile(
            new URL(
              '../prisma/migrations/' + migration + '/migration.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        );
      await db.query('BEGIN');
      await db.query("SELECT set_config('silk.sync_apply','on',true)");
      for (const [id, name] of [
        [admin, 'ADMIN'],
        [operator, 'OPERATOR'],
      ])
        await db.query(
          'INSERT INTO users(id,username,email,password_hash,role,token_version) VALUES($1,$2,$3,$4,$5,7)',
          [id, name, name + '@example.invalid', 'fixture', name],
        );
      await db.query(
        "INSERT INTO categories(id,name) VALUES($1,'preserved category')",
        [cat],
      );
      await db.query(
        "INSERT INTO products(id,user_id,category_id,name,price,stock) VALUES($1,$2,$3,'preserved product',19.90,7)",
        [product, operator, cat],
      );
      await db.query('COMMIT');
      await db.query(
        await readFile(
          new URL(
            '../prisma/migrations/20261110023925_configurable_rbac/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      assert.deepEqual(
        (
          await db.query(
            'SELECT role,token_version FROM users ORDER BY username',
          )
        ).rows,
        [
          { role: 'ADMIN', token_version: 8 },
          { role: 'OPERATOR', token_version: 8 },
        ],
      );
      assert.deepEqual(
        (await db.query('SELECT name,price,stock FROM products')).rows,
        [{ name: 'preserved product', price: '19.90', stock: 7 }],
      );
    }
    for (const db of clients)
      for (const migration of migrations.filter(
        (n) => n > '20261110023925_configurable_rbac',
      ))
        await db.query(
          await readFile(
            new URL(
              '../prisma/migrations/' + migration + '/migration.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        );
    const [a, b] = clients;
    await a.query("UPDATE _commerce_config SET write_role='PRIMARY'");
    await b.query("UPDATE _commerce_config SET write_role='REPLICA'");
    await a.query('BEGIN');
    await a.query(
      "INSERT INTO roles(id,code,name) VALUES($1,'READER','只读')",
      [role],
    );
    await a.query(
      "INSERT INTO role_permissions(role_id,permission_code,scope) VALUES($1,'product:read','OWN')",
      [role],
    );
    await a.query(
      'UPDATE users SET role_id=$1,token_version=token_version+1 WHERE id=$2',
      [role, operator],
    );
    await a.query('COMMIT');
    await b.query(
      "CREATE FUNCTION fail_role_grant() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test'; END $$; CREATE TRIGGER fail_role_grant BEFORE INSERT ON role_permissions FOR EACH ROW EXECUTE FUNCTION fail_role_grant()",
    );
    assert.equal((await syncDirection(a, b)).failed, 1);
    assert.equal(
      (await b.query('SELECT count(*)::int n FROM roles WHERE id=$1', [role]))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await b.query('SELECT token_version n FROM users WHERE id=$1', [
          operator,
        ])
      ).rows[0].n,
      8,
    );
    await b.query(
      'DROP TRIGGER fail_role_grant ON role_permissions;DROP FUNCTION fail_role_grant()',
    );
    assert.equal((await syncDirection(a, b)).failed, 0);
    assert.deepEqual(
      (
        await b.query('SELECT role_id,token_version FROM users WHERE id=$1', [
          operator,
        ])
      ).rows[0],
      { role_id: role, token_version: 9 },
    );
    assert.equal(
      (
        await b.query('SELECT scope FROM role_permissions WHERE role_id=$1', [
          role,
        ])
      ).rows[0].scope,
      'OWN',
    );
    await assert.rejects(
      b.query("UPDATE roles SET name='forged' WHERE id=$1", [role]),
      /COMMERCE_REPLICA_READ_ONLY/,
    );
    await assert.rejects(
      b.query("UPDATE users SET role='ADMIN' WHERE id=$1", [operator]),
      /ROLE_REPLICA_READ_ONLY/,
    );
    const stale = (
      await b.query('SELECT to_jsonb(u) body FROM users u WHERE id=$1', [
        operator,
      ])
    ).rows[0].body;
    await applyChange(a, {
      sequence: '0',
      event_id: randomUUID(),
      record_id: operator,
      table_name: 'users',
      operation: 'UPSERT',
      row_data: {
        ...stale,
        role: 'ADMIN',
        role_id: '00000000-0000-4000-8000-000000000010',
        token_version: 1,
      },
      origin_id: randomUUID(),
      changed_at: '2090-01-01T00:00:00Z',
    });
    assert.deepEqual(
      (
        await a.query(
          'SELECT role_id,role,token_version FROM users WHERE id=$1',
          [operator],
        )
      ).rows[0],
      { role_id: role, role: 'OPERATOR', token_version: 9 },
    );
    await a.query('BEGIN');
    await a.query("UPDATE role_permissions SET scope='ALL' WHERE role_id=$1", [
      role,
    ]);
    await a.query(
      'UPDATE users SET token_version=token_version+1 WHERE id=$1',
      [operator],
    );
    await a.query('COMMIT');
    await syncDirection(a, b);
    assert.equal(
      (
        await b.query('SELECT token_version n FROM users WHERE id=$1', [
          operator,
        ])
      ).rows[0].n,
      10,
    );
    assert.equal(
      (
        await b.query('SELECT scope FROM role_permissions WHERE role_id=$1', [
          role,
        ])
      ).rows[0].scope,
      'ALL',
    );
  } finally {
    for (const [i, db] of clients.entries()) {
      if (/^roles_sync_[a-f0-9]{32}_[ab]$/.test(schemas[i]))
        await db
          .query('DROP SCHEMA IF EXISTS "' + schemas[i] + '" CASCADE')
          .catch(() => {});
      await db.end().catch(() => {});
    }
  }
});
