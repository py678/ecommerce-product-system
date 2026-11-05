import { Client } from 'pg';
import { verifyPeers } from './sync/bridge.ts';

// Run only during maintenance, after BOTH migrations and backups and with the bridge stopped.
// Uses existing protected environment URLs; never accepts credentials as CLI arguments.
if (!process.env.DATABASE_URL || !process.env.PEER_DATABASE_URL)
  throw new Error('DATABASE_URL and PEER_DATABASE_URL are required');
const primary = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const replica = new Client({
  connectionString: process.env.PEER_DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const activate = process.argv.includes('--activate');
let transactions = false;
const tables = [
  'users',
  'categories',
  'products',
  'orders',
  'order_items',
  'order_logs',
] as const;
try {
  await primary.connect();
  await replica.connect();
  // TIMESTAMPTZ JSON rendering depends on the session zone. Compare instants
  // consistently even when local PostgreSQL uses Asia/Shanghai and Docker UTC.
  for (const db of [primary, replica]) await db.query("SET TIME ZONE 'UTC'");
  await verifyPeers(primary, replica);
  if (activate) {
    for (const db of [primary, replica]) {
      await db.query('BEGIN');
      transactions = true;
      await db.query("SET LOCAL lock_timeout='5s'");
      await db.query(
        'LOCK TABLE users,categories,products,orders,order_items,order_logs,_commerce_config IN SHARE ROW EXCLUSIVE MODE',
      );
    }
  }
  for (const [index, db] of [primary, replica].entries()) {
    const pending = (
      await db.query(
        'SELECT count(*)::int n FROM _sync_events WHERE delivered_at IS NULL',
      )
    ).rows[0].n;
    console.log(
      (index === 0 ? 'Docker' : 'Local') +
        ' pending journal events: ' +
        pending,
    );
    if (pending)
      throw new Error(
        'Drain the existing bridge queues before cutover; no events may be discarded',
      );
  }
  for (const table of tables) {
    const values = await Promise.all(
      [primary, replica].map((db) =>
        db.query(
          "SELECT count(*)::int n,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) digest FROM " +
            table +
            ' t',
        ),
      ),
    );
    if (values[0].rows[0].digest !== values[1].rows[0].digest)
      throw new Error(
        'Database contents differ: ' + table + '; resolve before activating',
      );
    console.log(table + ': consistent (' + values[0].rows[0].n + ' rows)');
  }
  if (activate) {
    // A partial infrastructure failure leaves maintenance active: rerun after fixing connectivity.
    // Never resume writers while roles are not complementary.
    await replica.query(
      "UPDATE _commerce_config SET write_role='REPLICA' WHERE id=1",
    );
    await primary.query(
      "UPDATE _commerce_config SET write_role='PRIMARY' WHERE id=1",
    );
    await replica.query('COMMIT');
    await primary.query('COMMIT');
    transactions = false;
    console.log('Commerce roles activated: Docker PRIMARY / local REPLICA');
  } else
    console.log(
      'Inspection passed; use --activate only after backups and stopping application writers',
    );
} catch (error) {
  if (transactions)
    await Promise.allSettled([
      primary.query('ROLLBACK'),
      replica.query('ROLLBACK'),
    ]);
  // Don't print connection URLs, row data or driver error objects.
  console.error(
    error instanceof Error && !(error as { code?: string }).code
      ? error.message
      : 'Commerce cutover failed; inspect connectivity/migration status',
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled([primary.end(), replica.end()]);
}
