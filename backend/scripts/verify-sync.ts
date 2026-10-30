import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Client } from 'pg';
import { hash } from 'bcryptjs';

// Compare privately in memory: never print account data, hashes or database credentials.
const a = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const b = new Client({
  connectionString: process.env.PEER_DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const tables = ['users', 'categories', 'products'] as const;
async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await setTimeout(500);
  }
  throw new Error('Synchronization did not converge within 20 seconds');
}
async function equal() {
  for (const table of tables) {
    const sql = `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id), '[]'::jsonb)::text AS data FROM "${table}" r`;
    const rows = await Promise.all([a.query(sql), b.query(sql)]);
    if (rows[0].rows[0].data !== rows[1].rows[0].data) return false;
  }
  for (const db of [a, b])
    if (
      (
        await db.query(
          'SELECT count(*) FROM _sync_events WHERE delivered_at IS NULL',
        )
      ).rows[0].count !== '0'
    )
      return false;
  return true;
}
const user = randomUUID();
const category = randomUUID();
const product = randomUUID();
let probeStarted = false;
try {
  await a.connect();
  await b.connect();
  // JSON timestamp text otherwise differs between Windows and container session time zones.
  for (const db of [a, b]) await db.query("SET TIME ZONE 'UTC'");
  await waitFor(equal);
  if (process.argv.includes('--probe')) {
    probeStarted = true;
    await a.query(
      'INSERT INTO users (id,username,email,password_hash) VALUES ($1,$2,$3,$4)',
      [
        user,
        `sync_${user}`,
        `${user}@example.invalid`,
        await hash(randomUUID(), 12),
      ],
    );
    await b.query('INSERT INTO categories (id,name) VALUES ($1,$2)', [
      category,
      `sync_${category}`,
    ]);
    await waitFor(equal);
    await a.query(
      'INSERT INTO products (id,user_id,category_id,name,price,stock) VALUES ($1,$2,$3,$4,12.34,5)',
      [product, user, category, 'Temporary sync verification'],
    );
    await waitFor(equal);
    await b.query(
      'UPDATE products SET price=99.95,stock=0,updated_at=now() WHERE id=$1',
      [product],
    );
    await waitFor(equal);
    const row = (
      await a.query('SELECT price,stock FROM products WHERE id=$1', [product])
    ).rows[0];
    assert.equal(row.price, '99.95');
    assert.equal(row.stock, 0);
    await a.query('DELETE FROM products WHERE id=$1', [product]);
    await waitFor(equal);
    await b.query('DELETE FROM categories WHERE id=$1', [category]);
    await a.query('DELETE FROM users WHERE id=$1', [user]);
    await waitFor(equal);
    probeStarted = false;
    console.log(
      'Live bidirectional INSERT/UPDATE/DELETE verification passed; temporary records removed.',
    );
  }
  for (const table of tables) {
    const count = (await a.query(`SELECT count(*) FROM "${table}"`)).rows[0]
      .count;
    console.log(`${table}: both databases equal, rows=${count}`);
  }
  console.log('No pending sync events in either database.');
} catch (error) {
  console.error(
    `Sync verification failed: ${String((error as { code?: string }).code ?? 'CHECK_FAILED')}`,
  );
  process.exitCode = 1;
} finally {
  if (probeStarted) {
    // Only remove this invocation's UUIDs; leave all existing business records untouched.
    for (const db of [a, b]) {
      for (const [table, id] of [
        ['products', product],
        ['categories', category],
        ['users', user],
      ])
        await db
          .query(`DELETE FROM "${table}" WHERE id=$1`, [id])
          .catch(() => {});
    }
  }
  await Promise.allSettled([a.end(), b.end()]);
}
