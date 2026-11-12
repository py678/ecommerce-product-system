import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from 'pg';
import { syncDirection } from './sync/bridge.ts';

if (process.env.RBAC_ISOLATED_TEST !== '1')
  throw new Error('Requires isolated runner');

test('商品上下架存量迁移、主副本复制和库存保留', async () => {
  const prefix = 'product_status_' + randomUUID().replaceAll('-', '');
  const schemas = [prefix + '_a', prefix + '_b'];
  const clients = schemas.map(
    () => new Client({ connectionString: process.env.DATABASE_URL }),
  );
  const connected = new Set<Client>();
  const user = randomUUID(),
    category = randomUUID(),
    product = randomUUID();
  const migrations = (
    await readdir(new URL('../prisma/migrations/', import.meta.url))
  )
    .filter((n) => /^\d/.test(n))
    .sort();
  const migration = migrations.find((n) => n.endsWith('_product_status'));
  assert.ok(migration);
  async function apply(db: Client, name: string) {
    await db.query(
      await readFile(
        new URL(
          '../prisma/migrations/' + name + '/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  }
  try {
    for (const [i, db] of clients.entries()) {
      await db.connect();
      connected.add(db);
      await db.query('CREATE SCHEMA "' + schemas[i] + '"');
      await db.query('SET search_path TO "' + schemas[i] + '"');
      for (const name of migrations.filter((n) => n < migration))
        await apply(db, name);
      await db.query(
        "INSERT INTO users(id,username,email,password_hash) VALUES($1,'status_fixture','status@example.invalid','fixture')",
        [user],
      );
      await db.query("INSERT INTO categories(id,name) VALUES($1,'状态测试')", [
        category,
      ]);
      await db.query(
        "INSERT INTO products(id,user_id,category_id,name,price,stock,stock_version) VALUES($1,$2,$3,'迁移前商品',12.35,7,3)",
        [product, user, category],
      );
      await db.query('UPDATE _sync_events SET delivered_at=clock_timestamp()');
      await db.query('UPDATE _commerce_config SET write_role=$1', [
        i === 0 ? 'PRIMARY' : 'REPLICA',
      ]);
      for (const name of migrations.filter((n) => n >= migration))
        await apply(db, name);
      const row = (
        await db.query(
          'SELECT status,stock,stock_version FROM products WHERE id=$1',
          [product],
        )
      ).rows[0];
      assert.deepEqual(row, {
        status: 'PUBLISHED',
        stock: 7,
        stock_version: 3,
      });
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int n FROM _sync_events WHERE delivered_at IS NULL',
          )
        ).rows[0].n,
        0,
        '新增默认列不应制造业务变更事件',
      );
    }
    const [a, b] = clients;
    const before = (
      await a.query('SELECT count(*)::int n FROM stock_movements')
    ).rows[0].n;
    for (const status of ['OFFLINE', 'PUBLISHED']) {
      await a.query(
        'UPDATE products SET status=$1,updated_at=clock_timestamp() WHERE id=$2',
        [status, product],
      );
      assert.equal((await syncDirection(a, b)).failed, 0);
      assert.deepEqual(
        (
          await b.query(
            'SELECT status,stock,stock_version FROM products WHERE id=$1',
            [product],
          )
        ).rows[0],
        { status, stock: 7, stock_version: 3 },
      );
      assert.deepEqual(
        await syncDirection(a, b),
        { delivered: 0, failed: 0 },
        '队列排空后不可重复应用',
      );
      assert.equal(
        (await a.query('SELECT count(*)::int n FROM stock_movements')).rows[0]
          .n,
        before,
      );
      assert.equal(
        (await b.query('SELECT count(*)::int n FROM stock_movements')).rows[0]
          .n,
        before,
      );
    }
    await assert.rejects(
      b.query("UPDATE products SET status='OFFLINE' WHERE id=$1", [product]),
      /COMMERCE_REPLICA_READ_ONLY/,
    );
    await assert.rejects(
      a.query("UPDATE products SET status='DRAFT' WHERE id=$1", [product]),
      /invalid input value for enum/,
    );
    const inserted = await a.query(
      "INSERT INTO products(user_id,category_id,name,price) VALUES($1,$2,'新商品',1.00) RETURNING status",
      [user, category],
    );
    assert.equal(inserted.rows[0].status, 'PUBLISHED');
    assert.equal((await syncDirection(a, b)).failed, 0);
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM products WHERE status='PUBLISHED'",
        )
      ).rows[0].n,
      2,
    );
  } finally {
    for (const [i, db] of clients.entries()) {
      if (!connected.has(db)) continue;
      try {
        await db.query('ROLLBACK');
        await db.query('SET search_path TO public');
        if (/^product_status_[a-f0-9]{32}_[ab]$/.test(schemas[i]))
          await db.query('DROP SCHEMA IF EXISTS "' + schemas[i] + '" CASCADE');
      } finally {
        await db.end();
      }
    }
  }
});
