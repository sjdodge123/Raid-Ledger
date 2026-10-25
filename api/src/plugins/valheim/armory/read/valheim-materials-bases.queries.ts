/**
 * ROK-1859 D5 — the two reads behind bases: every chest in the scope with
 * its position (cluster input + chest numbering) and its per-(prefab,
 * quality) stack sums. Same scan + scope fragments as every other Materials
 * query; never a row id or `creatorPlayerId`.
 */
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import type { ValheimLinkTx } from '../../link/valheim-link-token-lock';

type Exec = PostgresJsDatabase<typeof schema> | ValheimLinkTx;
const c = schema.valheimContainers;
const st = schema.valheimContainerStacks;

/** One chest as the base helpers need it (`shared` = privacy <> 'private'). */
export interface BaseInputRow {
  key: string;
  prefab: string;
  x: number;
  y: number;
  z: number;
  vehicle: boolean;
  shared: boolean;
}

/** One chest's sum of one (prefab, quality) — bigint arrives as a string. */
export interface StackSumRow {
  key: string;
  prefab: string;
  quality: number;
  total: string | number;
}

/** Every chest of the scan within `scope`, key-ordered. */
export function selectBaseInputs(
  db: Exec,
  scanId: number,
  scope: SQL,
): Promise<BaseInputRow[]> {
  return db
    .select({
      key: c.publicKey,
      prefab: c.prefab,
      x: c.x,
      y: c.y,
      z: c.z,
      vehicle: c.vehicle,
      shared: sql<boolean>`(${c.privacy} <> 'private')`,
    })
    .from(c)
    .where(and(eq(c.scanId, scanId), scope))
    .orderBy(asc(c.publicKey));
}

/** SUM(stack) per (chest, prefab, quality) over the scope's chests. */
export function selectStackSums(
  db: Exec,
  scanId: number,
  scope: SQL,
): Promise<StackSumRow[]> {
  return db
    .select({
      key: c.publicKey,
      prefab: st.prefab,
      quality: st.quality,
      total: sql<string>`sum(${st.stack})::bigint`,
    })
    .from(st)
    .innerJoin(c, eq(c.id, st.containerId))
    .where(and(eq(c.scanId, scanId), scope))
    .groupBy(c.publicKey, st.prefab, st.quality)
    .orderBy(asc(c.publicKey), asc(st.prefab), asc(st.quality));
}
