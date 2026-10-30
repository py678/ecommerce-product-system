import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const primary = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const peer = new Client({
  connectionString: process.env.PEER_DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const allowedUser = process.argv
  .find((arg) => arg.startsWith('--merge-user='))
  ?.slice('--merge-user='.length);
const backupDir = process.env.SYNC_BACKUP_DIR ?? '/backups';
let primaryTransaction = false;
let peerTransaction = false;
try {
  await primary.connect();
  await peer.connect();
  const nodes = await Promise.all(
    [primary, peer].map((db) =>
      db
        .query('SELECT system_identifier FROM pg_control_system()')
        .catch(() => null),
    ),
  );
  if (
    nodes[0] &&
    nodes[1] &&
    nodes[0].rows[0].system_identifier === nodes[1].rows[0].system_identifier
  )
    throw new Error('Expected different PostgreSQL instances');
  // Lock both sets before taking backups or merging so application writes cannot slip between them.
  for (const [index, db] of [primary, peer].entries()) {
    await db.query('BEGIN');
    if (index === 0) primaryTransaction = true;
    else peerTransaction = true;
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query(
      'LOCK TABLE users, categories, products IN SHARE ROW EXCLUSIVE MODE',
    );
  }
  const snapshots: Record<string, Record<string, unknown>[]>[] = [];
  for (const db of [primary, peer]) {
    const snapshot: Record<string, Record<string, unknown>[]> = {};
    for (const table of ['users', 'categories', 'products'])
      snapshot[table] = (await db.query(`SELECT * FROM "${table}"`)).rows;
    snapshots.push(snapshot);
  }
  const merges: {
    old: Record<string, unknown>;
    canonical: Record<string, unknown>;
  }[] = [];
  for (const local of snapshots[1].users) {
    const collisions = snapshots[0].users.filter(
      (remote) =>
        remote.id !== local.id &&
        (remote.username === local.username || remote.email === local.email),
    );
    if (!collisions.length) continue;
    if (
      collisions.length !== 1 ||
      !allowedUser ||
      local.username !== allowedUser ||
      collisions[0].username !== allowedUser
    )
      throw new Error('Unapproved username/email conflict; no data changed');
    merges.push({ old: local, canonical: collisions[0] });
  }
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  for (const [index, snapshot] of snapshots.entries())
    await writeFile(
      join(backupDir, `${stamp}-${index === 0 ? 'docker' : 'local'}.json`),
      JSON.stringify(snapshot, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
  for (const { old, canonical } of merges) {
    // Preserve the complete original account in the backup; preserve and re-parent any products.
    await peer.query('UPDATE users SET username=$2, email=$3 WHERE id=$1', [
      old.id,
      `sync-merge-${old.id}`,
      `sync-merge-${old.id}@example.invalid`,
    ]);
    await peer.query(
      `INSERT INTO users (id,username,email,password_hash,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username,email=EXCLUDED.email,
         password_hash=EXCLUDED.password_hash,updated_at=EXCLUDED.updated_at`,
      [
        canonical.id,
        canonical.username,
        canonical.email,
        canonical.password_hash,
        canonical.created_at,
        canonical.updated_at,
      ],
    );
    await peer.query('UPDATE products SET user_id=$2 WHERE user_id=$1', [
      old.id,
      canonical.id,
    ]);
    await peer.query('DELETE FROM users WHERE id=$1', [old.id]);
  }
  await peer.query('COMMIT');
  peerTransaction = false;
  await primary.query('COMMIT');
  primaryTransaction = false;
  console.log(
    `Business backups saved; merged ${merges.length} explicitly approved account(s). Other rows retained.`,
  );
} catch (error) {
  if (peerTransaction) await peer.query('ROLLBACK');
  if (primaryTransaction) await primary.query('ROLLBACK');
  // Do not print pg error details that might contain private values.
  console.error(
    `Sync preparation stopped: ${String((error as { code?: string }).code ?? (error as Error).message)}`,
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled([primary.end(), peer.end()]);
}
