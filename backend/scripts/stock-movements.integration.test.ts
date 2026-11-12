import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from 'pg';
import { applyChanges, syncDirection } from './sync/bridge.ts';

if (process.env.RBAC_ISOLATED_TEST !== '1')
  throw new Error('Requires isolated runner');

// 缺失流水复制、允许重写或拆分源事务时，这些断言必须失败。
test('库存流水迁移与复制保持唯一基线、追加不变性和整事务一致性', async (t) => {
  const prefix = 'stock_sync_' + randomUUID().replaceAll('-', '');
  const schemas = [prefix + '_a', prefix + '_b', prefix + '_empty'];
  const clients = schemas.map(
    () => new Client({ connectionString: process.env.DATABASE_URL }),
  );
  const connected = new Set<Client>();
  const userId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const migrations = (
    await readdir(new URL('../prisma/migrations/', import.meta.url))
  )
    .filter((name) => /^\d/.test(name))
    .sort();
  const movementMigration = migrations.find((name) =>
    name.endsWith('_stock_movements'),
  );
  assert.ok(movementMigration, '必须存在库存流水迁移');
  async function migrate(db: Client, name: string) {
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
  async function snapshot(db: Client) {
    return (
      await db.query(
        'SELECT to_jsonb(m) body FROM stock_movements m ORDER BY id',
      )
    ).rows;
  }
  try {
    for (const [i, db] of clients.entries()) {
      await db.connect();
      connected.add(db);
      await db.query('CREATE SCHEMA "' + schemas[i] + '"');
      await db.query('SET search_path TO "' + schemas[i] + '"');
      for (const name of migrations.filter((name) => name < movementMigration))
        await migrate(db, name);
      if (i < 2) {
        await db.query(
          "INSERT INTO users(id,username,email,password_hash) VALUES($1,'stock_fixture','stock@example.invalid','fixture')",
          [userId],
        );
        await db.query(
          "INSERT INTO categories(id,name) VALUES($1,'库存验收')",
          [categoryId],
        );
        await db.query(
          "INSERT INTO products(id,user_id,category_id,name,price,stock,stock_version) VALUES($1,$2,$3,'迁移前商品',12.35,7,3)",
          [productId, userId, categoryId],
        );
      }
      await db.query('UPDATE _sync_events SET delivered_at=clock_timestamp()');
      await db.query('UPDATE _commerce_config SET write_role=$1', [
        i === 0 ? 'PRIMARY' : i === 1 ? 'REPLICA' : 'STANDALONE',
      ]);
      for (const name of migrations.filter((name) => name >= movementMigration))
        await migrate(db, name);
    }
    const [a, b, empty] = clients;
    assert.equal(
      (await b.query('SELECT count(*)::int n FROM stock_movements')).rows[0].n,
      0,
      '副本迁移不可自行生成不同 UUID 的基线',
    );
    const movementId = randomUUID();
    await a.query('BEGIN');
    await a.query('UPDATE products SET stock=5 WHERE id=$1', [productId]);
    await a.query(
      "INSERT INTO stock_movements(id,product_id,product_name,owner_id,type,before_stock,quantity_change,after_stock,stock_version,actor_id,actor_name,reason,operation_key) VALUES($1,$2,'迁移前商品',$3,'ADJUSTMENT',7,-2,5,4,$3,'stock_fixture','盘点修正',$4)",
      [movementId, productId, userId, 'adjust:' + movementId],
    );
    await a.query('COMMIT');
    const events = (
      await a.query(
        'SELECT *,sequence::text,changed_at::text FROM _sync_events WHERE delivered_at IS NULL ORDER BY _sync_events.sequence',
      )
    ).rows;

    await t.test(
      '复制完整流水并幂等重放，包括时间戳和内部归属快照',
      async () => {
        assert.ok(
          events.some((event) => event.table_name === 'stock_movements'),
          '流水必须进入源事务队列',
        );
        await applyChanges(b, events);
        assert.deepEqual(await snapshot(b), await snapshot(a));
        assert.equal(await applyChanges(b, events), 0);
        assert.deepEqual(await snapshot(b), await snapshot(a));
        assert.equal(
          (
            await b.query(
              'SELECT stock,stock_version FROM products WHERE id=$1',
              [productId],
            )
          ).rows[0].stock,
          5,
        );
      },
    );

    await t.test('空库迁移和存量迁移只生成主库唯一启用基线', async () => {
      assert.equal(
        (await empty.query('SELECT count(*)::int n FROM stock_movements'))
          .rows[0].n,
        0,
      );
      const baseline = (
        await a.query(
          "SELECT before_stock,quantity_change,after_stock,stock_version,owner_id FROM stock_movements WHERE type='BASELINE'",
        )
      ).rows;
      assert.deepEqual(baseline, [
        {
          before_stock: 0,
          quantity_change: 7,
          after_stock: 7,
          stock_version: 3,
          owner_id: userId,
        },
      ]);
      assert.equal(
        (
          await b.query(
            "SELECT count(*)::int n FROM stock_movements WHERE type='BASELINE'",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await a.query('SELECT stock_version FROM products WHERE id=$1', [
            productId,
          ])
        ).rows[0].stock_version,
        4,
      );
      await syncDirection(a, b);
      assert.deepEqual(await snapshot(b), await snapshot(a));
    });

    await t.test(
      '已有 UUID 的不同内容及 DELETE 拒绝，较旧事件也不得绕过校验',
      async () => {
        const movement = events.find(
          (event) => event.record_id === movementId,
        )!;
        for (const changed_at of [
          '2000-01-01T00:00:00Z',
          '2099-01-01T00:00:00Z',
        ]) {
          await assert.rejects(
            applyChanges(b, [
              {
                ...movement,
                event_id: randomUUID(),
                changed_at,
                row_data: { ...movement.row_data, reason: '伪造原因' },
              },
            ]),
            /STOCK_MOVEMENT_CONFLICT/,
          );
        }
        const product = events.find(
          (event) => event.table_name === 'products',
        )!;
        await assert.rejects(
          applyChanges(b, [
            {
              ...product,
              event_id: randomUUID(),
              changed_at: '2099-01-01T00:00:00Z',
              row_data: { ...product.row_data, stock: 99, stock_version: 99 },
            },
            {
              ...movement,
              event_id: randomUUID(),
              row_data: {
                ...movement.row_data,
                reason: '冲突必须回滚同组库存',
              },
            },
          ]),
          /STOCK_MOVEMENT_CONFLICT/,
        );
        assert.deepEqual(
          (
            await b.query(
              'SELECT stock,stock_version FROM products WHERE id=$1',
              [productId],
            )
          ).rows[0],
          { stock: 5, stock_version: 4 },
        );
        await assert.rejects(
          applyChanges(b, [
            { ...movement, operation: 'DELETE', row_data: null },
          ]),
          /STOCK_MOVEMENT_IMMUTABLE/,
        );
        await assert.rejects(
          applyChanges(a, [movement]),
          /COMMERCE_PRIMARY_REJECTS_REPLICA/,
        );
        assert.deepEqual(await snapshot(b), await snapshot(a));
      },
    );

    await t.test(
      '目标流水失败导致库存和版本整组回滚，修复后恢复且不重复扣库存',
      async () => {
        await a.query('BEGIN');
        await a.query('UPDATE products SET stock=4 WHERE id=$1', [productId]);
        await a.query(
          "INSERT INTO stock_movements(product_id,product_name,owner_id,type,before_stock,quantity_change,after_stock,stock_version,actor_id,actor_name,reason,operation_key) VALUES($1,'调整后商品',$2,'ADJUSTMENT',5,-1,4,5,$2,'stock_fixture','再次盘点',$3)",
          [productId, userId, 'adjust:' + randomUUID()],
        );
        await a.query('COMMIT');
        await b.query(
          "CREATE FUNCTION fail_stock_movement() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'STOCK_TEST_FAILURE'; END $$; CREATE TRIGGER fail_stock_movement BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION fail_stock_movement()",
        );
        assert.equal((await syncDirection(a, b)).failed, 1);
        assert.deepEqual(
          (
            await b.query(
              'SELECT stock,stock_version FROM products WHERE id=$1',
              [productId],
            )
          ).rows[0],
          { stock: 5, stock_version: 4 },
        );
        assert.equal(
          (await b.query('SELECT count(*)::int n FROM stock_movements')).rows[0]
            .n,
          2,
        );
        await b.query(
          'DROP TRIGGER fail_stock_movement ON stock_movements; DROP FUNCTION fail_stock_movement()',
        );
        assert.equal((await syncDirection(a, b)).failed, 0);
        assert.deepEqual(await snapshot(b), await snapshot(a));
        assert.deepEqual(
          (
            await b.query(
              'SELECT stock,stock_version FROM products WHERE id=$1',
              [productId],
            )
          ).rows[0],
          { stock: 4, stock_version: 5 },
        );
        assert.equal((await syncDirection(a, b)).delivered, 0);
      },
    );

    await t.test(
      '数据库拒绝副本本地新增和流水修改、删除、截断，商品删除保留快照',
      async () => {
        await assert.rejects(
          b.query(
            "INSERT INTO stock_movements(product_id,product_name,owner_id,type,before_stock,quantity_change,after_stock,stock_version,reason,operation_key) VALUES($1,'伪造',$2,'INITIAL',0,0,0,0,'伪造',$3)",
            [randomUUID(), userId, randomUUID()],
          ),
          /COMMERCE_REPLICA_READ_ONLY/,
        );
        for (const db of [a, b]) {
          await assert.rejects(
            db.query("UPDATE stock_movements SET reason='篡改' WHERE id=$1", [
              movementId,
            ]),
            /STOCK_MOVEMENT_IMMUTABLE|COMMERCE_REPLICA_READ_ONLY/,
          );
          await assert.rejects(
            db.query('DELETE FROM stock_movements WHERE id=$1', [movementId]),
            /STOCK_MOVEMENT_IMMUTABLE|COMMERCE_REPLICA_READ_ONLY/,
          );
          await assert.rejects(
            db.query('TRUNCATE stock_movements'),
            /STOCK_MOVEMENT_IMMUTABLE|TRUNCATE bypasses row synchronization/,
          );
        }
        await a.query("UPDATE products SET name='已改名商品' WHERE id=$1", [
          productId,
        ]);
        await a.query('DELETE FROM products WHERE id=$1', [productId]);
        assert.equal((await syncDirection(a, b)).failed, 0);
        for (const db of [a, b]) {
          assert.equal(
            (await db.query('SELECT id FROM products WHERE id=$1', [productId]))
              .rowCount,
            0,
          );
          assert.deepEqual(
            (
              await db.query(
                'SELECT product_name,owner_id,actor_name FROM stock_movements WHERE id=$1',
                [movementId],
              )
            ).rows[0],
            {
              product_name: '迁移前商品',
              owner_id: userId,
              actor_name: 'stock_fixture',
            },
          );
        }
      },
    );
  } finally {
    for (const [i, db] of clients.entries()) {
      if (!connected.has(db)) continue;
      await db.query('ROLLBACK').catch(() => {});
      if (/^stock_sync_[a-f0-9]{32}_(a|b|empty)$/.test(schemas[i]))
        await db
          .query('DROP SCHEMA IF EXISTS "' + schemas[i] + '" CASCADE')
          .catch(() => {});
      await db.end().catch(() => {});
    }
  }
});
