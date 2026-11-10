import type { Client } from 'pg';

const columns = {
  users: [
    'id',
    'username',
    'email',
    'password_hash',
    'token_version',
    'role',
    'role_id',
    'created_at',
    'updated_at',
  ],
  categories: ['id', 'name', 'created_at', 'updated_at'],
  roles: [
    'id',
    'code',
    'name',
    'description',
    'enabled',
    'system',
    'version',
    'created_at',
    'updated_at',
  ],
  role_permissions: ['id', 'role_id', 'permission_code', 'scope'],
  products: [
    'id',
    'user_id',
    'category_id',
    'name',
    'description',
    'cover_image',
    'price',
    'stock',
    'stock_version',
    'created_at',
    'updated_at',
  ],
  orders: [
    'id',
    'order_no',
    'creator_id',
    'idempotency_key',
    'request_hash',
    'customer_name',
    'phone',
    'address',
    'remark',
    'status',
    'total_amount',
    'carrier',
    'tracking_no',
    'confirmed_at',
    'shipped_at',
    'completed_at',
    'cancelled_at',
    'created_at',
    'updated_at',
  ],
  order_items: [
    'id',
    'order_id',
    'product_id',
    'product_name',
    'cover_image',
    'unit_price',
    'quantity',
    'subtotal',
  ],
  order_logs: [
    'id',
    'order_id',
    'actor_id',
    'actor_name',
    'action',
    'from_status',
    'to_status',
    'reason',
    'created_at',
  ],
} as const;

interface Change {
  sequence: string;
  transaction_id?: string;
  event_id: string;
  table_name: keyof typeof columns;
  record_id: string;
  operation: 'UPSERT' | 'DELETE';
  row_data: Record<string, unknown> | null;
  changed_at: string;
  origin_id: string;
  last_error?: string | null;
}

async function applyInTransaction(
  target: Client,
  change: Change,
): Promise<boolean> {
  const fields = columns[change.table_name];
  if (!fields) throw new Error('Unknown synchronized table');

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
      if (change.table_name === 'users' && change.row_data.role === 'VIEWER')
        change.row_data = { ...change.row_data, role: 'OPERATOR' };
      const quoted = fields.map((field) => `"${field}"`).join(', ');
      const primaryTarget =
        change.table_name === 'users' &&
        (await commerceRole(target)) === 'PRIMARY';
      const updates = fields
        .filter((field) => field !== 'id')
        .map((field) => {
          // Role assignment is authoritative on PRIMARY, even if a replica profile/password event is newer.
          if (primaryTarget && (field === 'role_id' || field === 'role'))
            return `"${field}"="users"."${field}"`;
          // An older profile event must never restore a password/role or revive revoked credentials.
          if (change.table_name === 'users' && field === 'token_version')
            return '"token_version"=GREATEST("users"."token_version",EXCLUDED."token_version")';
          if (
            change.table_name === 'users' &&
            (field === 'password_hash' ||
              field === 'role' ||
              field === 'role_id')
          )
            return (
              '"' +
              field +
              '"=CASE WHEN EXCLUDED."token_version">="users"."token_version" THEN EXCLUDED."' +
              field +
              '" ELSE "users"."' +
              field +
              '" END'
            );
          return `"${field}"=EXCLUDED."${field}"`;
        })
        .join(', ');
      await target.query(
        `INSERT INTO "${change.table_name}" (${quoted})
           SELECT ${quoted} FROM jsonb_populate_record(NULL::"${change.table_name}", $1::jsonb)
           ON CONFLICT (id) DO UPDATE SET ${updates}`,
        [
          JSON.stringify(
            change.table_name === 'users'
              ? {
                  ...change.row_data,
                  token_version: change.row_data.token_version ?? 0,
                  role: change.row_data.role ?? 'OPERATOR',
                  role_id:
                    change.row_data.role_id ??
                    (change.row_data.role === 'ADMIN'
                      ? '00000000-0000-4000-8000-000000000010'
                      : '00000000-0000-4000-8000-000000000011'),
                }
              : change.table_name === 'products'
                ? {
                    ...change.row_data,
                    stock_version: change.row_data.stock_version ?? 0,
                  }
                : change.row_data,
          ),
        ],
      );
    }
  }
  return !!version.rowCount;
}

// Replays an entire SOURCE transaction in one target transaction. A replay never executes business stock logic.
export async function applyChanges(
  target: Client,
  changes: Change[],
): Promise<number> {
  await target.query('BEGIN');
  try {
    await target.query("SET LOCAL lock_timeout = '3s'");
    await target.query("SELECT set_config('silk.sync_apply', 'on', true)");
    let applied = 0;
    for (const change of changes)
      if (await applyInTransaction(target, change)) applied++;
    await target.query('COMMIT');
    return applied;
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  }
}
export async function applyChange(
  target: Client,
  change: Change,
): Promise<boolean> {
  return (await applyChanges(target, [change])) > 0;
}
async function commerceRole(db: Client) {
  const table = await db.query(
    "SELECT to_regclass('_commerce_config') AS name",
  );
  if (!table.rows[0].name) return 'STANDALONE';
  return (await db.query('SELECT write_role FROM _commerce_config WHERE id=1'))
    .rows[0]?.write_role as string;
}
async function syncTransactions(source: Client, target: Client) {
  const groups = await source.query<{ transaction_id: string }>(
    'SELECT transaction_id FROM _sync_events WHERE delivered_at IS NULL GROUP BY transaction_id ORDER BY min(sequence) LIMIT 20',
  );
  let delivered = 0,
    failed = 0;
  for (const group of groups.rows) {
    const events = await source.query<Change>(
      'SELECT *, sequence::text, changed_at::text FROM _sync_events WHERE transaction_id=$1 AND delivered_at IS NULL ORDER BY _sync_events.sequence',
      [group.transaction_id],
    );
    try {
      await applyChanges(target, events.rows);
      await source.query(
        'UPDATE _sync_events SET delivered_at=clock_timestamp(),attempted_at=clock_timestamp(),last_error=NULL WHERE sequence=ANY($1::bigint[])',
        [events.rows.map((e) => e.sequence)],
      );
      delivered += events.rowCount ?? 0;
    } catch (error) {
      const code = String(
        (error as { code?: string }).code ?? 'SYNC_ERROR',
      ).slice(0, 32);
      await source.query(
        'UPDATE _sync_events SET attempted_at=clock_timestamp(),last_error=$2 WHERE transaction_id=$1 AND delivered_at IS NULL',
        [group.transaction_id, code],
      );
      if (events.rows.some((e) => e.last_error !== code))
        console.error('Sync transaction pending: ' + code);
      failed++;
      break; // Never overtake a failed creation with a later cancellation.
    }
  }
  return { delivered, failed };
}

export async function syncDirection(source: Client, target: Client) {
  let sourceRole: string, targetRole: string;
  try {
    sourceRole = await commerceRole(source);
    targetRole = await commerceRole(target);
  } catch (error) {
    // An unavailable peer must preserve pending events and the existing retry contract.
    // Never fall back to standalone row replay when a role cannot be verified.
    const code = String(
      (error as { code?: string }).code ?? 'SYNC_ERROR',
    ).slice(0, 32);
    const pending = await source.query(
      'UPDATE _sync_events SET attempted_at=clock_timestamp(),last_error=$1 WHERE sequence IN (SELECT sequence FROM _sync_events WHERE delivered_at IS NULL ORDER BY sequence LIMIT 100)',
      [code],
    );
    return { delivered: 0, failed: pending.rowCount ?? 0 };
  }
  if (sourceRole !== 'STANDALONE' || targetRole !== 'STANDALONE') {
    if (!(
      (sourceRole === 'PRIMARY' && targetRole === 'REPLICA') ||
      (sourceRole === 'REPLICA' && targetRole === 'PRIMARY')
    ))
      throw new Error('Configure complementary commerce PRIMARY/REPLICA roles');
    return syncTransactions(source, target);
  }
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
