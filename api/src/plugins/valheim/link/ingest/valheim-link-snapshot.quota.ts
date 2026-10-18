import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../../../drizzle/schema';
import { positiveIntEnv } from '../blobs/valheim-link-blob.quota';
import { holdServerLock, type ValheimLinkTx } from '../valheim-link-token-lock';

const { valheimLinkSnapshots: snapshots } = schema;

/** Defaults: 2 000 snapshots and 256 MiB of payload per server. */
export const DEFAULT_MAX_SNAPSHOTS_PER_SERVER = 2000;
export const DEFAULT_MAX_SNAPSHOT_BYTES_PER_SERVER = 256 * 1024 ** 2;

/** One server's stored snapshot count + `octet_length(payload::text)` sum. */
export interface ValheimSnapshotUsage {
  count: number;
  bytes: number;
}

/** Per-server snapshot caps, read per call (env-overridable). */
export function snapshotQuota(): { maxSnapshots: number; maxBytes: number } {
  return {
    maxSnapshots: positiveIntEnv(
      'VALHEIM_LINK_MAX_SNAPSHOTS_PER_SERVER',
      DEFAULT_MAX_SNAPSHOTS_PER_SERVER,
    ),
    maxBytes: positiveIntEnv(
      'VALHEIM_LINK_MAX_SNAPSHOT_BYTES_PER_SERVER',
      DEFAULT_MAX_SNAPSHOT_BYTES_PER_SERVER,
    ),
  };
}

/** True when one more snapshot of `incomingBytes` stays within both caps. */
export function snapshotFits(
  usage: ValheimSnapshotUsage,
  incomingBytes: number,
): boolean {
  const { maxSnapshots, maxBytes } = snapshotQuota();
  return (
    usage.count + 1 <= maxSnapshots && usage.bytes + incomingBytes <= maxBytes
  );
}

/**
 * Inside the write transaction: take the server's snapshot advisory lock,
 * then admit the row. An update of an existing key is always admitted
 * (latest-wins replaces in place); a NEW key must fit both caps.
 */
export async function admitSnapshotIn(
  tx: ValheimLinkTx,
  row: schema.NewValheimLinkSnapshot,
): Promise<boolean> {
  await holdServerLock(tx, 'valheim-link-snapshots', row.pelicanServerId);
  const existing = await tx
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.pelicanServerId, row.pelicanServerId),
        eq(snapshots.kind, row.kind),
        eq(snapshots.snapshotKey, row.snapshotKey),
      ),
    )
    .limit(1);
  if (existing.length > 0) return true;
  const { usage, incoming } = await usageIn(tx, row);
  return snapshotFits(usage, incoming);
}

async function usageIn(
  tx: ValheimLinkTx,
  row: schema.NewValheimLinkSnapshot,
): Promise<{ usage: ValheimSnapshotUsage; incoming: number }> {
  const payload = JSON.stringify(row.payload);
  const [r] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<string>`coalesce(sum(octet_length(${snapshots.payload}::text)), 0)`,
      incoming: sql<number>`octet_length(${payload}::jsonb::text)`,
    })
    .from(snapshots)
    .where(eq(snapshots.pelicanServerId, row.pelicanServerId));
  return {
    usage: { count: Number(r?.count ?? 0), bytes: Number(r?.bytes ?? 0) },
    incoming: Number(r?.incoming ?? payload.length),
  };
}
