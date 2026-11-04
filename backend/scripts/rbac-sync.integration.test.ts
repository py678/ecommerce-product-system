import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from 'pg';
import { applyChange, syncDirection } from './sync/bridge.ts';
if (process.env.RBAC_ISOLATED_TEST !== '1')
  throw new Error('Explicit RBAC_ISOLATED_TEST=1 is required');
test('role/version synchronization converges and rejects stale privilege restoration', async () => {
  const prefix = 'rbac_sync_' + randomUUID().replaceAll('-', '');
  const schemas = [prefix + '_a', prefix + '_b'];
  if (!schemas.every((s) => /^rbac_sync_[a-f0-9]{32}_[ab]$/.test(s)))
    throw new Error('Unsafe test schema');
  const clients = schemas.map(
    () => new Client({ connectionString: process.env.DATABASE_URL }),
  );
  try {
    for (const [i, c] of clients.entries()) {
      await c.connect();
      await c.query('CREATE SCHEMA "' + schemas[i] + '"');
      await c.query('SET search_path TO "' + schemas[i] + '"');
      for (const name of (
        await readdir(new URL('../prisma/migrations/', import.meta.url))
      )
        .filter((n) => /^\d/.test(n))
        .sort())
        await c.query(
          await readFile(
            new URL(
              '../prisma/migrations/' + name + '/migration.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        );
    }
    const [a, b] = clients;
    const id = randomUUID();
    await a.query(
      "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,$4,'OPERATOR')",
      [id, 'sync_fixture', 'sync@example.invalid', 'fixture-hash'],
    );
    await syncDirection(a, b);
    await a.query(
      "UPDATE users SET role='VIEWER',token_version=token_version+1 WHERE id=$1",
      [id],
    );
    await syncDirection(a, b);
    assert.deepEqual(
      (await b.query('SELECT role,token_version FROM users WHERE id=$1', [id]))
        .rows[0],
      { role: 'VIEWER', token_version: 1 },
    );
    // Simulate a delayed pre-revocation snapshot with a later wall-clock timestamp.
    const row = (
      await a.query('SELECT to_jsonb(u) AS body FROM users u WHERE id=$1', [id])
    ).rows[0].body;
    await applyChange(b, {
      sequence: '0',
      event_id: randomUUID(),
      table_name: 'users',
      record_id: id,
      operation: 'UPSERT',
      row_data: {
        ...row,
        role: 'ADMIN',
        token_version: 0,
        password_hash: 'stale-fixture-hash',
      },
      changed_at: '2090-01-01T00:00:00Z',
      origin_id: randomUUID(),
    });
    assert.deepEqual(
      (
        await b.query(
          'SELECT role,token_version,password_hash FROM users WHERE id=$1',
          [id],
        )
      ).rows[0],
      { role: 'VIEWER', token_version: 1, password_hash: 'fixture-hash' },
    );
    await b.query(
      "UPDATE users SET role='ADMIN',token_version=token_version+1 WHERE id=$1",
      [id],
    );
    await syncDirection(b, a);
    await syncDirection(a, b);
    for (const c of clients)
      assert.deepEqual(
        (
          await c.query('SELECT role,token_version FROM users WHERE id=$1', [
            id,
          ])
        ).rows[0],
        { role: 'ADMIN', token_version: 2 },
      );
    const legacyId = randomUUID();
    await applyChange(a, {
      sequence: '0',
      event_id: randomUUID(),
      table_name: 'users',
      record_id: legacyId,
      operation: 'UPSERT',
      row_data: {
        ...row,
        id: legacyId,
        username: 'legacy_fixture',
        email: 'legacy@example.invalid',
        role: undefined,
        token_version: undefined,
      },
      changed_at: '2026-01-01T00:00:00Z',
      origin_id: randomUUID(),
    });
    assert.deepEqual(
      (
        await a.query('SELECT role,token_version FROM users WHERE id=$1', [
          legacyId,
        ])
      ).rows[0],
      { role: 'OPERATOR', token_version: 0 },
    );
  } finally {
    for (const [i, c] of clients.entries()) {
      // Only random test namespaces created above may be removed; never public/business schemas.
      await c
        .query('DROP SCHEMA IF EXISTS "' + schemas[i] + '" CASCADE')
        .catch(() => {});
      await c.end();
    }
  }
});
