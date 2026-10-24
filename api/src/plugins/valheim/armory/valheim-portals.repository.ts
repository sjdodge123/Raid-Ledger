import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { VALHEIM_LINK_PORTALS_MAX } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';

type Db = PostgresJsDatabase<typeof schema>;
type Exec = Db | ValheimLinkTx;
const { valheimPortalScans: scans, valheimPortals: portals } = schema;

/** Columns a newer scan overwrites (never `id`, server or world). */
const SCAN_UPDATE = {
  gameVersion: sql.raw('excluded."game_version"'),
  capturedAt: sql.raw('excluded."captured_at"'),
  omitted: sql.raw('excluded."omitted"'),
  portalCount: sql.raw('excluded."portal_count"'),
  sourceSnapshotId: sql.raw('excluded."source_snapshot_id"'),
  importedAt: sql`now()`,
};

/**
 * ROK-1946 D3 latest-wins: insert the scan, or overwrite it only when this
 * one is strictly newer. Returns the scan id, or null when stale.
 */
export async function upsertPortalScan(
  tx: ValheimLinkTx,
  values: schema.NewValheimPortalScan,
): Promise<number | null> {
  const [row] = await tx
    .insert(scans)
    .values(values)
    .onConflictDoUpdate({
      target: [scans.pelicanServerId, scans.worldUid],
      set: SCAN_UPDATE,
      setWhere: sql`${scans.capturedAt} < excluded.captured_at`,
    })
    .returning({ id: scans.id });
  return row?.id ?? null;
}

/** Drop every portal of a scan. */
export async function clearScanPortals(
  tx: ValheimLinkTx,
  scanId: number,
): Promise<void> {
  await tx.delete(portals).where(eq(portals.scanId, scanId));
}

/**
 * One batched insert: 7 params/row × ≤4096 portals (contract max) =
 * ≤28 672, under Postgres' 65 535 — no chunking needed.
 */
export async function insertPortals(
  tx: ValheimLinkTx,
  rows: schema.NewValheimPortalRow[],
): Promise<void> {
  if (rows.length) await tx.insert(portals).values(rows);
}

/** A world's portals scan header; null before its first portals import. */
export async function findPortalScan(
  exec: Exec,
  pelicanServerId: number,
  worldUid: string,
): Promise<schema.ValheimPortalScan | null> {
  const [row] = await exec
    .select()
    .from(scans)
    .where(
      and(
        eq(scans.pelicanServerId, pelicanServerId),
        eq(scans.worldUid, worldUid),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * A scan's portals, ordered x then z (stable across re-imports; ids are not).
 * Capped at the contract max the ingest schema already enforces.
 */
export function listScanPortals(
  exec: Exec,
  scanId: number,
): Promise<schema.ValheimPortalRow[]> {
  return exec
    .select()
    .from(portals)
    .where(eq(portals.scanId, scanId))
    .orderBy(asc(portals.x), asc(portals.z), asc(portals.id))
    .limit(VALHEIM_LINK_PORTALS_MAX);
}

/** The server's newest portals scan on any world; null before the first. */
export async function findLatestPortalScan(
  exec: Exec,
  pelicanServerId: number,
): Promise<schema.ValheimPortalScan | null> {
  const [row] = await exec
    .select()
    .from(scans)
    .where(eq(scans.pelicanServerId, pelicanServerId))
    .orderBy(desc(scans.capturedAt), desc(scans.id))
    .limit(1);
  return row ?? null;
}
