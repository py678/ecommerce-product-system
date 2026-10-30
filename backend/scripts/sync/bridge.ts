import type { Client } from 'pg';

const columns = {
  users: [
    'id',
    'username',
    'email',
    'password_hash',
    'created_at',
    'updated_at',
  ],
  categories: ['id', 'name', 'created_at', 'updated_at'],
  products: [
    'id',
    'user_id',
    'category_id',
    'name',
    'description',
    'price',
    'stock',
    'created_at',
    'updated_at',
  ],
} as const;

interface Change {
  sequence: string;
  event_id: string;
  table_name: keyof typeof columns;
  record_id: string;
  operation: 'UPSERT' | 'DELETE';
  row_data: Record<string, unknown> | null;
  changed_at: string;
  origin_id: string;
  last_error?: string | null;
}

export async function applyChange(
  target: Client,
  change: Change,
): Promise<boolean> {
  const fields = columns[change.table_name];
  if (!fields) throw new Error('Unknown synchronized table');
  await target.query('BEGIN');
  try {
    await target.query("SET LOCAL lock_timeout = '3s'");
    await target.query("SELECT set_config('silk.sync_apply', 'on', true)");
    // Lock existing business rows before their version, matching the capture trigger's lock order.
    await target.query(
      `SELECT id FROM "${change.table_name}" WHERE id = $1 FOR UPDATE`,
      [change.record_id],
    );
    const version = await target.query(
      `INSERT INTO _sync_versions (table_name, record_id, changed_at, origin_id, event_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (table_name, record_id) DO UPDATE SET
         changed_at=EXCLUDED.changed_at, origin_id=EXCLUDED.origin_id, event_id=EXCLUDED.event_id
       WHERE (_sync_versions.changed_at, _sync_versions.origin_id, _sync_versions.event_id)
           < (EXCLUDED.changed_at, EXCLUDED.origin_id, EXCLUDED.event_id)
       RETURNING record_id`,
      [
        change.table_name,
        change.record_id,
        change.changed_at,
        change.origin_id,
        change.event_id,
      ],
    );
    if (version.rowCount) {
      if (change.operation === 'DELETE') {
        await target.query(`DELETE FROM "${change.table_name}" WHERE id=$1`, [
          change.record_id,
        ]);
      } else {
        if (!change.row_data || change.row_data.id !== change.record_id)
          throw new Error('Invalid change payload');
        const quoted = fields.map((field) => `"${field}"`).join(', ');
        const updates = fields
          .filter((field) => field !== 'id')
          .map((field) => `"${field}"=EXCLUDED."${field}"`)
          .join(', ');
        await target.query(
          `INSERT INTO "${change.table_name}" (${quoted})
           SELECT ${quoted} FROM jsonb_populate_record(NULL::"${change.table_name}", $1::jsonb)
           ON CONFLICT (id) DO UPDATE SET ${updates}`,
          [JSON.stringify(change.row_data)],
        );
      }
    }
    await target.query('COMMIT');
    return !!version.rowCount;
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  }
}

export async function syncDirection(source: Client, target: Client) {
  const pending = await source.query<Change>(
    `SELECT sequence::text, event_id, table_name, record_id, operation, row_data,
            changed_at::text, origin_id, last_error FROM _sync_events
     WHERE delivered_at IS NULL ORDER BY attempted_at NULLS FIRST, sequence LIMIT 100`,
  );
  let delivered = 0;
  let failed = 0;
  for (const change of pending.rows) {
    try {
      await applyChange(target, change);
      await source.query(
        'UPDATE _sync_events SET delivered_at=clock_timestamp(), attempted_at=clock_timestamp(), last_error=NULL WHERE sequence=$1',
        [change.sequence],
      );
      delivered++;
    } catch (error) {
      // Never log credentials, SQL parameters, row payloads or password hashes.
      const code = String(
        (error as { code?: string }).code ?? 'SYNC_ERROR',
      ).slice(0, 32);
      await source.query(
        'UPDATE _sync_events SET attempted_at=clock_timestamp(), last_error=$2 WHERE sequence=$1',
        [change.sequence, code],
      );
      if (change.last_error !== code)
        console.error(
          `Sync event ${change.event_id} (${change.table_name}) pending: ${code}`,
        );
      failed++;
    }
  }
  return { delivered, failed };
}

export async function verifyPeers(first: Client, second: Client) {
  const a = await first.query('SELECT node_id FROM _sync_identity WHERE id=1');
  const b = await second.query('SELECT node_id FROM _sync_identity WHERE id=1');
  if (!a.rowCount || !b.rowCount || a.rows[0].node_id === b.rows[0].node_id)
    throw new Error('Sync requires two separately initialized databases');
  for (const db of [first, second]) {
    const lock = await db.query(
      'SELECT pg_try_advisory_lock(73510942) AS acquired',
    );
    if (!lock.rows[0].acquired)
      throw new Error('Another sync bridge already owns this database');
  }
}
