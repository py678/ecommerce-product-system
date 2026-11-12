import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { Client } from 'pg';
import { syncDirection, applyChanges } from './sync/bridge.ts';

if (process.env.SYNC_DISPOSABLE_TEST !== '1')
  throw new Error('Requires two disposable test databases');
const a = new Client({ connectionString: process.env.DATABASE_URL });
const b = new Client({ connectionString: process.env.PEER_DATABASE_URL });

test('order inventory replication is atomic, ordered, idempotent and single writer', async (t) => {
  await a.connect();
  await b.connect();
  try {
    for (const db of [a, b]) {
      assert.equal(
        (await db.query("SELECT to_regclass('users') AS t")).rows[0].t,
        null,
        'Only empty disposable DBs',
      );
      for (const dir of (
        await readdir(new URL('../prisma/migrations/', import.meta.url))
      ).sort()) {
        if (/^\d/.test(dir))
          await db.query(
            await readFile(
              new URL(
                '../prisma/migrations/' + dir + '/migration.sql',
                import.meta.url,
              ),
              'utf8',
            ),
          );
      }
    }
    await a.query("UPDATE _commerce_config SET write_role='PRIMARY'");
    await b.query("UPDATE _commerce_config SET write_role='REPLICA'");
    const user = randomUUID(),
      cat = randomUUID();
    await a.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,'sync_order','sync@example.invalid','fixture')",
      [user],
    );
    await a.query("INSERT INTO categories(id,name) VALUES($1,'sync orders')", [
      cat,
    ]);
    const products = Array.from({ length: 50 }, () => randomUUID());
    for (const id of products)
      await a.query(
        'INSERT INTO products(id,user_id,category_id,name,price,stock) VALUES($1::uuid,$2,$3,$1::text,12.35,10)',
        [id, user, cat],
      );
    while ((await syncDirection(a, b)).delivered > 0) {
      /* Drain initialization before creating the order. */
    }
    const { DatabaseService } =
      await import('../dist/database/database.service.js');
    const { OrdersService } = await import('../dist/orders/orders.service.js');
    const { CommerceAuthorityService } =
      await import('../dist/commerce/commerce.module.js');
    const db = new DatabaseService();
    await db.$connect();
    const service = new OrdersService(db, new CommerceAuthorityService(db), {
      resourceChanged() {},
      orderChanged() {},
    } as never);
    const actor = { id: user, role: 'OPERATOR' as const };
    let orderId: string;
    try {
      await t.test(
        'creation >100 events is never split; target fault rolls back ALL stock/items/order/log',
        async () => {
          const order = await service.create(actor, {
            idempotencyKey: randomUUID(),
            customerName: '同步验收',
            phone: '13800000000',
            address: '测试地址',
            items: products.map((productId) => ({ productId, quantity: 2 })),
          });
          orderId = order.id;
          // 50 商品更新 + 50 库存流水 + 订单 + 50 明细 + 日志，同属一个源事务。
          const events = await a.query(
            'SELECT * FROM _sync_events WHERE delivered_at IS NULL ORDER BY sequence',
          );
          assert.equal(events.rowCount, 152);
          assert.equal(
            new Set(events.rows.map((r) => r.transaction_id)).size,
            1,
          );
          await b.query(
            "CREATE FUNCTION fail_order_item() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER fail_order_item BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fail_order_item()",
          );
          const failed = await syncDirection(a, b);
          assert.ok(failed.failed > 0);
          assert.equal(
            (await b.query('SELECT count(*)::int n FROM orders')).rows[0].n,
            0,
          );
          assert.equal(
            (await b.query('SELECT min(stock)::int n FROM products')).rows[0].n,
            10,
          );
          assert.equal(
            (
              await b.query(
                "SELECT count(*)::int n FROM _sync_versions WHERE table_name='orders'",
              )
            ).rows[0].n,
            0,
          );
          // A later cancellation must remain behind the failed creation transaction.
          await service.transition(orderId, actor, 'cancel', {
            reason: '测试取消',
          });
          const failedAgain = await syncDirection(a, b);
          assert.ok(failedAgain.failed > 0);
          assert.equal(
            (await b.query('SELECT count(*)::int n FROM orders')).rows[0].n,
            0,
          );
          await b.query(
            'DROP TRIGGER fail_order_item ON order_items; DROP FUNCTION fail_order_item()',
          );
          // Hold back the later transaction to inspect the complete >100-event group after creation.
          const creation = events.rows;
          await applyChanges(b, creation);
          assert.equal(
            (await b.query('SELECT count(*)::int n FROM order_items')).rows[0]
              .n,
            50,
          );
          assert.equal(
            (await b.query('SELECT min(stock)::int n FROM products')).rows[0].n,
            8,
          );
          await applyChanges(b, creation);
          assert.equal(
            (await b.query('SELECT min(stock)::int n FROM products')).rows[0].n,
            8,
          );
          await syncDirection(a, b);
          await syncDirection(a, b);
          for (const table of [
            'products',
            'orders',
            'order_items',
            'order_logs',
            'stock_movements',
          ]) {
            const source = (
              await a.query(
                'SELECT row_to_json(t) AS row FROM ' + table + ' t ORDER BY id',
              )
            ).rows;
            const replica = (
              await b.query(
                'SELECT row_to_json(t) AS row FROM ' + table + ' t ORDER BY id',
              )
            ).rows;
            assert.deepEqual(
              replica,
              source,
              table + ' must converge, including stock_version',
            );
          }
          assert.equal(
            (await b.query('SELECT min(stock)::int n FROM products')).rows[0].n,
            10,
          );
        },
      );
      await t.test(
        'replica rejects API/service and SQL commerce mutations; reverse overwrite rejected',
        async () => {
          await assert.rejects(
            b.query('UPDATE products SET stock=999 WHERE id=$1', [products[0]]),
            /COMMERCE_REPLICA_READ_ONLY/,
          );
          const source = (
            await a.query(
              "SELECT * FROM _sync_events WHERE table_name='products' ORDER BY sequence DESC LIMIT 1",
            )
          ).rows;
          const forged = source.map((r) => ({
            ...r,
            event_id: randomUUID(),
            changed_at: '2099-01-01T00:00:00Z',
            row_data: { ...r.row_data, stock: 999 },
          }));
          await assert.rejects(
            applyChanges(a, forged),
            /COMMERCE_PRIMARY_REJECTS_REPLICA/,
          );
          assert.equal(
            (
              await a.query('SELECT stock FROM products WHERE id=$1', [
                products[0],
              ])
            ).rows[0].stock,
            10,
          );
          await assert.rejects(
            service.transition(orderId!, actor, 'cancel', { reason: '重复' }),
            /当前订单状态/,
          );
          const previous = process.env.DATABASE_URL;
          process.env.DATABASE_URL = process.env.PEER_DATABASE_URL;
          const replicaDb = new DatabaseService();
          try {
            await assert.rejects(
              new CommerceAuthorityService(replicaDb).requireWriter(),
              /只读副本/,
            );
          } finally {
            await replicaDb.$disconnect();
            process.env.DATABASE_URL = previous;
          }
        },
      );
    } finally {
      await db.$disconnect();
    }
    await t.test(
      'cutover compares timestamp instants across different database timezones',
      async () => {
        await b.query(
          "ALTER DATABASE postgres SET timezone TO 'Asia/Shanghai'",
        );
        const output = execFileSync(
          process.execPath,
          ['scripts/commerce-cutover.ts'],
          { encoding: 'utf8' },
        );
        assert.match(output, /Inspection passed/);
      },
    );
  } finally {
    await a.end();
    await b.end();
  }
});
