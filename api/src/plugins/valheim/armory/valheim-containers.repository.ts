import { desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';

type Db = PostgresJsDatabase<typeof schema>;
type Exec = Db | ValheimLinkTx;
const {
  valheimContainerScans: scans,
  valheimContainers: containers,
  valheimContainerStacks: stacks,
} = schema;

/** 16 params/row → 16 000 params, under Postgres' 65 535 (spec §2.3). */
export const CONTAINER_INSERT_CHUNK = 1_000;
/** 4 params/row → 20 000 params. */
export const STACK_INSERT_CHUNK = 5_000;

/** A stored container's internal id ↔ its public key (D7). */
export interface InsertedContainer {
  id: number;
  publicKey: string;
}

/** Columns a newer scan overwrites (never `id`, server or world). */
const SCAN_UPDATE = {
  gameVersion: sql.raw('excluded."game_version"'),
  capturedAt: sql.raw('excluded."captured_at"'),
  omittedShared: sql.raw('excluded."omitted_shared"'),
  omittedPrivate: sql.raw('excluded."omitted_private"'),
  containerCount: sql.raw('excluded."container_count"'),
  stackCount: sql.raw('excluded."stack_count"'),
  sourceSnapshotId: sql.raw('excluded."source_snapshot_id"'),
  importedAt: sql`now()`,
};

/**
 * D3 latest-wins: insert the scan, or overwrite it only when this one is
 * strictly newer. Returns the scan id, or null when stale (no row touched).
 */
export async function upsertContainerScan(
  tx: ValheimLinkTx,
  values: schema.NewValheimContainerScan,
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

/** Drop every container of a scan; stacks follow by FK cascade. */
export async function clearScanContainers(
  tx: ValheimLinkTx,
  scanId: number,
): Promise<void> {
  await tx.delete(containers).where(eq(containers.scanId, scanId));
}

/** Bulk-insert containers in chunks; returns id ↔ public key for the stacks. */
export async function insertContainers(
  tx: ValheimLinkTx,
  rows: schema.NewValheimContainerRow[],
): Promise<InsertedContainer[]> {
  const out: InsertedContainer[] = [];
  for (const chunk of chunked(rows, CONTAINER_INSERT_CHUNK)) {
    const done = await tx
      .insert(containers)
      .values(chunk)
      .returning({ id: containers.id, publicKey: containers.publicKey });
    out.push(...done);
  }
  return out;
}

/** Bulk-insert stacks in chunks. */
export async function insertContainerStacks(
  tx: ValheimLinkTx,
  rows: schema.NewValheimContainerStackRow[],
): Promise<void> {
  for (const chunk of chunked(rows, STACK_INSERT_CHUNK)) {
    await tx.insert(stacks).values(chunk);
  }
}

/**
 * D4: the server's newest scan (any world) — the one the hub shows; null
 * before the first containers import.
 */
export async function findLatestContainerScan(
  exec: Exec,
  pelicanServerId: number,
): Promise<schema.ValheimContainerScan | null> {
  const [row] = await exec
    .select()
    .from(scans)
    .where(eq(scans.pelicanServerId, pelicanServerId))
    .orderBy(desc(scans.capturedAt), desc(scans.id))
    .limit(1);
  return row ?? null;
}

/** Split `rows` into arrays of at most `size` (empty input → no chunks). */
export function chunked<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
