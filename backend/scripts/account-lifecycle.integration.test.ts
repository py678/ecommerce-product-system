import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from 'pg';
import { applyChange, syncDirection } from './sync/bridge.ts';
if (process.env.RBAC_ISOLATED_TEST !== '1')
  throw new Error('Requires isolated runner');
test('account lifecycle preserves upgrade data, overrides newer peer profile events and never resurrects purged UUIDs', async () => {
  const prefix = 'account_sync_' + randomUUID().replaceAll('-', '');
  const schemas = [prefix + '_a', prefix + '_b'];
  const clients = schemas.map(
    () => new Client({ connectionString: process.env.DATABASE_URL }),
  );
  const id = randomUUID();
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
      for (const migration of migrations.filter(
        (n) => n < '20261110070741_account_lifecycle',
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
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,token_version) VALUES($1,'preserved','preserved@example.invalid','fixture',8)",
        [id],
      );
      await db.query('UPDATE _sync_events SET delivered_at=clock_timestamp()');
      await db.query('UPDATE _commerce_config SET write_role=$1', [
        i === 0 ? 'PRIMARY' : 'REPLICA',
      ]);
      for (const migration of migrations.filter(
        (n) => n >= '20261110070741_account_lifecycle',
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
      assert.deepEqual(
        (
          await db.query(
            'SELECT username,token_version,deleted_at FROM users WHERE id=$1',
            [id],
          )
        ).rows[0],
        { username: 'preserved', token_version: 8, deleted_at: null },
      );
    }
    const [a, b] = clients;
    const stale = (
      await b.query('SELECT to_jsonb(u) body FROM users u WHERE id=$1', [id])
    ).rows[0].body;
    await assert.rejects(
      b.query('UPDATE users SET deleted_at=now() WHERE id=$1', [id]),
      /ACCOUNT_REPLICA_READ_ONLY/,
    );
    await assert.rejects(
      b.query('DELETE FROM users WHERE id=$1', [id]),
      /ACCOUNT_REPLICA_READ_ONLY/,
    );
    // Simulate a profile event with a future peer clock. PRIMARY lifecycle must still converge.
    await b.query(
      "UPDATE _sync_versions SET changed_at='2090-01-01' WHERE table_name='users' AND record_id=$1",
      [id],
    );
    await b.query("UPDATE users SET email='new@example.invalid' WHERE id=$1", [
      id,
    ]);
    await a.query(
      "UPDATE users SET deleted_at=now(),delete_reason='leaver',token_version=token_version+1 WHERE id=$1",
      [id],
    );
    assert.equal((await syncDirection(a, b)).failed, 0);
    assert.ok(
      (await b.query('SELECT deleted_at FROM users WHERE id=$1', [id])).rows[0]
        .deleted_at,
    );
    assert.equal((await syncDirection(b, a)).failed, 0);
    assert.ok(
      (await a.query('SELECT deleted_at FROM users WHERE id=$1', [id])).rows[0]
        .deleted_at,
    );
    await a.query(
      'UPDATE users SET deleted_at=NULL,delete_reason=NULL,token_version=token_version+1 WHERE id=$1',
      [id],
    );
    assert.equal((await syncDirection(a, b)).failed, 0);
    assert.equal(
      (await b.query('SELECT deleted_at FROM users WHERE id=$1', [id])).rows[0]
        .deleted_at,
      null,
    );
    await a.query('BEGIN');
    await a.query(
      'UPDATE users SET deleted_at=now(),token_version=token_version+1 WHERE id=$1',
      [id],
    );
    await a.query('INSERT INTO user_tombstones(id) VALUES($1)', [id]);
    await a.query('DELETE FROM users WHERE id=$1', [id]);
    await a.query('COMMIT');
    assert.equal((await syncDirection(a, b)).failed, 0);
    for (const db of clients) {
      assert.equal(
        (await db.query('SELECT id FROM users WHERE id=$1', [id])).rowCount,
        0,
      );
      await applyChange(db, {
        sequence: '0',
        event_id: randomUUID(),
        record_id: id,
        table_name: 'users',
        operation: 'UPSERT',
        row_data: stale,
        changed_at: '2099-01-01T00:00:00Z',
        origin_id: randomUUID(),
      });
      assert.equal(
        (await db.query('SELECT id FROM users WHERE id=$1', [id])).rowCount,
        0,
      );
      assert.equal(
        (await db.query('SELECT id FROM user_tombstones WHERE id=$1', [id]))
          .rowCount,
        1,
      );
      await assert.rejects(
        db.query('UPDATE user_tombstones SET purged_at=now() WHERE id=$1', [
          id,
        ]),
        /TOMBSTONE_IMMUTABLE|REPLICA_READ_ONLY/,
      );
    }
  } finally {
    for (const [i, db] of clients.entries()) {
      if (/^account_sync_[a-f0-9]{32}_[ab]$/.test(schemas[i]))
        await db
          .query('DROP SCHEMA IF EXISTS "' + schemas[i] + '" CASCADE')
          .catch(() => {});
      await db.end().catch(() => {});
    }
  }
});
