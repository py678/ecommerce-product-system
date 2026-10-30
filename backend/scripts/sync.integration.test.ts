import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { syncDirection, verifyPeers } from './sync/bridge.ts';

// These URLs must be two disposable databases; refuse to run without explicit test opt-in.
if (process.env.SYNC_DISPOSABLE_TEST !== '1')
  throw new Error('Use dedicated disposable sync-test databases');
const a = new Client({ connectionString: process.env.DATABASE_URL });
const b = new Client({ connectionString: process.env.PEER_DATABASE_URL });
async function rounds(count = 3) {
  for (let i = 0; i < count; i++) {
    await syncDirection(a, b);
    await syncDirection(b, a);
  }
}
test('two independent PostgreSQL databases converge without losing pending changes', async (t) => {
  await a.connect();
  await b.connect();
  try {
    for (const db of [a, b]) {
      const empty = await db.query(
        "SELECT to_regclass('public.users') AS existing",
      );
      assert.equal(
        empty.rows[0].existing,
        null,
        'Test databases must be empty',
      );
      for (const name of ['20261029060000_init_catalog'])
        await db.query(
          await readFile(
            new URL(
              `../prisma/migrations/${name}/migration.sql`,
              import.meta.url,
            ),
            'utf8',
          ),
        );
    }
    await t.test(
      'approved account merge preserves products, other users and backups; unapproved conflicts abort',
      async () => {
        const canonical = randomUUID();
        const old = randomUUID();
        const other = randomUUID();
        const cat = randomUUID();
        const item = randomUUID();
        const backupDir = await mkdtemp(join(tmpdir(), 'silk-sync-test-'));
        try {
          for (const [db, id, hash] of [
            [a, canonical, 'docker-hash'],
            [b, old, 'local-hash'],
          ] as const)
            await db.query(
              'INSERT INTO users (id,username,email,password_hash) VALUES ($1,$2,$3,$4)',
              [id, 'py666', 'merge@example.invalid', hash],
            );
          await b.query(
            'INSERT INTO users (id,username,email,password_hash) VALUES ($1,$2,$3,$4)',
            [other, 'keep_me', 'keep@example.invalid', 'keep-hash'],
          );
          await b.query('INSERT INTO categories (id,name) VALUES ($1,$2)', [
            cat,
            'Keep category',
          ]);
          await b.query(
            'INSERT INTO products (id,user_id,category_id,name,price) VALUES ($1,$2,$3,$4,12.34)',
            [item, old, cat, 'Keep product'],
          );
          const run = promisify(execFile);
          const options = {
            env: { ...process.env, SYNC_BACKUP_DIR: backupDir },
          };
          const script = new URL('./prepare-sync.ts', import.meta.url);
          const { fileURLToPath } = await import('node:url');
          await assert.rejects(
            run(process.execPath, [fileURLToPath(script)], options),
          );
          assert.equal(
            (await b.query('SELECT id FROM users WHERE username=$1', ['py666']))
              .rows[0].id,
            old,
          );
          await run(
            process.execPath,
            [fileURLToPath(script), '--merge-user=py666'],
            options,
          );
          assert.equal(
            (
              await b.query(
                'SELECT id,password_hash FROM users WHERE username=$1',
                ['py666'],
              )
            ).rows[0].id,
            canonical,
          );
          assert.equal(
            (
              await b.query('SELECT password_hash FROM users WHERE id=$1', [
                canonical,
              ])
            ).rows[0].password_hash,
            'docker-hash',
          );
          assert.equal(
            (await b.query('SELECT user_id FROM products WHERE id=$1', [item]))
              .rows[0].user_id,
            canonical,
          );
          assert.equal(
            (
              await b.query('SELECT password_hash FROM users WHERE id=$1', [
                other,
              ])
            ).rows[0].password_hash,
            'keep-hash',
          );
          const files = await readdir(backupDir);
          assert.equal(files.length, 2);
          const localBackup = JSON.parse(
            await readFile(
              join(
                backupDir,
                files.find((f) => f.endsWith('-local.json'))!,
              ),
              'utf8',
            ),
          );
          assert.ok(
            localBackup.users.some((u: { id: string }) => u.id === old),
          );
        } finally {
          for (const db of [a, b]) {
            await db.query('DELETE FROM products');
            await db.query('DELETE FROM categories');
            await db.query('DELETE FROM users');
          }
          await rm(backupDir, { recursive: true });
        }
      },
    );
    const bootstrapped = randomUUID();
    await a.query('INSERT INTO categories (id,name) VALUES ($1,$2)', [
      bootstrapped,
      'Existing before sync migration',
    ]);
    for (const db of [a, b])
      await db.query(
        await readFile(
          new URL(
            '../prisma/migrations/20261030040000_bidirectional_sync/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    await verifyPeers(a, b);
    await t.test('migration bootstraps existing rows', async () => {
      await rounds();
      assert.equal(
        (
          await b.query('SELECT name FROM categories WHERE id=$1', [
            bootstrapped,
          ])
        ).rows[0].name,
        'Existing before sync migration',
      );
      await b.query('DELETE FROM categories WHERE id=$1', [bootstrapped]);
      await rounds();
    });
    const user = randomUUID();
    const category = randomUUID();
    const product = randomUUID();
    await t.test(
      'direct SQL insert, relations and precise price reach the peer',
      async () => {
        await a.query(
          'INSERT INTO users (id,username,email,password_hash) VALUES ($1,$2,$3,$4)',
          [user, 'sync_owner', 'sync@example.invalid', 'test-only-hash'],
        );
        await a.query('INSERT INTO categories (id,name) VALUES ($1,$2)', [
          category,
          'Original',
        ]);
        await a.query(
          'INSERT INTO products (id,user_id,category_id,name,price,stock) VALUES ($1,$2,$3,$4,$5,$6)',
          [product, user, category, 'Product', '9999999999.99', 7],
        );
        await rounds();
        const row = (
          await b.query('SELECT * FROM products WHERE id=$1', [product])
        ).rows[0];
        assert.equal(row.price, '9999999999.99');
        assert.equal(row.user_id, user);
        assert.equal(
          (await b.query('SELECT count(*) FROM _sync_events')).rows[0].count,
          '1',
          'Applying remote changes must not echo',
        );
      },
    );
    await t.test(
      'peer updates and inserts travel back to the primary',
      async () => {
        await b.query('UPDATE products SET stock=0,price=99.95 WHERE id=$1', [
          product,
        ]);
        await b.query('UPDATE categories SET name=$2 WHERE id=$1', [
          category,
          'Peer updated',
        ]);
        const other = randomUUID();
        await b.query('INSERT INTO categories (id,name) VALUES ($1,$2)', [
          other,
          'Peer created',
        ]);
        await rounds();
        assert.equal(
          (await a.query('SELECT stock FROM products WHERE id=$1', [product]))
            .rows[0].stock,
          0,
        );
        assert.equal(
          (await a.query('SELECT name FROM categories WHERE id=$1', [category]))
            .rows[0].name,
          'Peer updated',
        );
        assert.equal(
          (
            await a.query('SELECT count(*) FROM categories WHERE id=$1', [
              other,
            ])
          ).rows[0].count,
          '1',
        );
      },
    );
    await t.test(
      'competing updates converge to the newer change regardless of delivery order',
      async () => {
        await a.query('UPDATE categories SET name=$2 WHERE id=$1', [
          category,
          'Older',
        ]);
        await b.query('UPDATE categories SET name=$2 WHERE id=$1', [
          category,
          'Newer',
        ]);
        await rounds();
        for (const db of [a, b])
          assert.equal(
            (
              await db.query('SELECT name FROM categories WHERE id=$1', [
                category,
              ])
            ).rows[0].name,
            'Newer',
          );
      },
    );
    await t.test(
      'outage backlog survives and is applied on recovery',
      async () => {
        const offline = new Client({
          connectionString: process.env.PEER_DATABASE_URL,
        });
        await offline.connect();
        await offline.end();
        await a.query('UPDATE products SET stock=23 WHERE id=$1', [product]);
        const failed = await syncDirection(a, offline);
        assert.ok(failed.failed > 0);
        assert.ok(
          Number(
            (
              await a.query(
                'SELECT count(*) FROM _sync_events WHERE delivered_at IS NULL',
              )
            ).rows[0].count,
          ) > 0,
        );
        await rounds();
        assert.equal(
          (await b.query('SELECT stock FROM products WHERE id=$1', [product]))
            .rows[0].stock,
          23,
        );
      },
    );
    await t.test(
      'unique conflicts stay pending, preserve both rows and recover after correction',
      async () => {
        const first = randomUUID();
        const second = randomUUID();
        await a.query(
          'INSERT INTO users (id,username,email,password_hash) VALUES ($1,$2,$3,$4)',
          [first, 'collision', 'first@example.invalid', 'test-hash'],
        );
        await b.query(
          'INSERT INTO users (id,username,email,password_hash) VALUES ($1,$2,$3,$4)',
          [second, 'collision', 'second@example.invalid', 'test-hash'],
        );
        await rounds(1);
        assert.equal(
          (
            await a.query('SELECT id FROM users WHERE username=$1', [
              'collision',
            ])
          ).rows[0].id,
          first,
        );
        assert.equal(
          (
            await b.query('SELECT id FROM users WHERE username=$1', [
              'collision',
            ])
          ).rows[0].id,
          second,
        );
        await b.query('UPDATE users SET username=$2 WHERE id=$1', [
          second,
          'collision_peer',
        ]);
        await rounds(5);
        for (const db of [a, b])
          assert.equal(
            (await db.query('SELECT count(*) FROM users')).rows[0].count,
            '3',
          );
      },
    );
    await t.test(
      'deletes travel both ways and tombstones prevent stale resurrection',
      async () => {
        await b.query('DELETE FROM products WHERE id=$1', [product]);
        await rounds();
        assert.equal(
          (await a.query('SELECT count(*) FROM products')).rows[0].count,
          '0',
        );
        await a.query('DELETE FROM categories WHERE id=$1', [category]);
        await rounds();
        assert.equal(
          (
            await b.query('SELECT count(*) FROM categories WHERE id=$1', [
              category,
            ])
          ).rows[0].count,
          '0',
        );
        await a.query(
          "UPDATE _sync_events SET delivered_at=NULL WHERE table_name='products' AND operation='UPSERT'",
        );
        await rounds();
        assert.equal(
          (await b.query('SELECT count(*) FROM products')).rows[0].count,
          '0',
        );
        for (const db of [a, b])
          assert.equal(
            (
              await db.query(
                'SELECT count(*) FROM _sync_events WHERE delivered_at IS NULL',
              )
            ).rows[0].count,
            '0',
          );
      },
    );
    await t.test(
      'TRUNCATE and primary key changes are rejected instead of bypassing synchronization',
      async () => {
        await assert.rejects(a.query('TRUNCATE products'), /TRUNCATE/);
        await assert.rejects(
          a.query('UPDATE users SET id=$2 WHERE id=$1', [user, randomUUID()]),
          /primary key/,
        );
      },
    );
  } finally {
    await Promise.allSettled([a.end(), b.end()]);
  }
});
