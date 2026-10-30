import { Client } from 'pg';
import { setTimeout } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { syncDirection, verifyPeers } from './sync/bridge.ts';

const primaryUrl = process.env.DATABASE_URL;
const peerUrl = process.env.PEER_DATABASE_URL;
if (!primaryUrl || !peerUrl)
  throw new Error('DATABASE_URL and PEER_DATABASE_URL are required');
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
while (!stopping) {
  const first = new Client({
    connectionString: primaryUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  const second = new Client({
    connectionString: peerUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  const onError = () => {
    /* Queries surface errors to the reconnect loop. */
  };
  first.on('error', onError);
  second.on('error', onError);
  try {
    await first.connect();
    await second.connect();
    await verifyPeers(first, second);
    console.log('Two-way database sync connected');
    let cycle = 0;
    while (!stopping) {
      const outbound = await syncDirection(first, second);
      const inbound = await syncDirection(second, first);
      if (!outbound.failed && !inbound.failed)
        await writeFile('/tmp/silk-sync-heartbeat', String(Date.now()));
      if (outbound.delivered || inbound.delivered)
        console.log(
          `Synced changes: primary-to-peer=${outbound.delivered}, peer-to-primary=${inbound.delivered}`,
        );
      if (++cycle % 3600 === 0) {
        // Keep recent acknowledged changes for diagnosis; retain tombstones indefinitely.
        for (const db of [first, second])
          await db.query(
            "DELETE FROM _sync_events WHERE delivered_at < now() - interval '7 days'",
          );
      }
      await setTimeout(1000);
    }
  } catch (error) {
    console.error(
      `Sync connection will retry: ${String((error as { code?: string }).code ?? 'CONFIG_OR_CONNECTION')}`,
    );
  } finally {
    await Promise.allSettled([first.end(), second.end()]);
  }
  if (!stopping) await setTimeout(3000);
}
