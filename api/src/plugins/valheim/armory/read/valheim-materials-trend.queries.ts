/**
 * ROK-2014 — the reads behind the Materials trend: the server/world's newest
 * play-day headers and their end-of-day totals summed per (day, prefab,
 * shared) — and per base. Rows pass through the same shared/personal (D13)
 * and vehicle (D10) rules as the live totals; `owner` is never selected.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import type { ValheimLinkTx } from '../../link/valheim-link-token-lock';
import {
  personalOwnerSql,
  type MaterialsViewer,
} from './valheim-materials.privacy';

type Exec = PostgresJsDatabase<typeof schema> | ValheimLinkTx;
const D = schema.valheimContainerDays;
const I = schema.valheimContainerItemDays;
const B = schema.valheimContainerBaseItemDays;

/** Header days read: the newest one only serves as the next one's baseline. */
export const TREND_HEADER_DAYS = 4;

export interface TrendDayRow {
  id: number;
  playDate: string;
}

/** One day's end total of one prefab in one segment — bigint as a string. */
export interface TrendItemSumRow {
  dayId: number;
  prefab: string;
  shared: boolean;
  total: string | number;
}

export interface TrendBaseSumRow extends TrendItemSumRow {
  baseKey: string;
  baseX: number;
  baseZ: number;
}

export interface TrendInputs {
  days: TrendDayRow[];
  items: TrendItemSumRow[];
  bases: TrendBaseSumRow[];
}

/** Newest `limit` play days of the server's `worldUid`, newest first. */
export function selectTrendDays(
  db: Exec,
  serverId: number,
  worldUid: string,
  limit: number,
): Promise<TrendDayRow[]> {
  return db
    .select({ id: D.id, playDate: D.playDate })
    .from(D)
    .where(and(eq(D.pelicanServerId, serverId), eq(D.worldUid, worldUid)))
    .orderBy(desc(D.playDate))
    .limit(limit);
}

/** Shared rows + the viewer's personal ones, minus vehicles when asked. */
function trendScope(
  t: typeof I | typeof B,
  viewer: MaterialsViewer,
  includeVehicles: boolean,
): SQL {
  const own = personalOwnerSql(viewer, D.pelicanServerId, t.owner);
  const owner = sql`(${t.owner} = '' OR ${own})`;
  return includeVehicles ? owner : sql`(${owner} AND NOT ${t.vehicle})`;
}

const sharedOf = (t: typeof I | typeof B) => sql<boolean>`(${t.owner} = '')`;

/** SUM(total) per (day, prefab, shared) over the given days. */
export function selectTrendItemSums(
  db: Exec,
  dayIds: number[],
  viewer: MaterialsViewer,
  includeVehicles: boolean,
): Promise<TrendItemSumRow[]> {
  const shared = sharedOf(I);
  return db
    .select({
      dayId: I.dayId,
      prefab: I.prefab,
      shared,
      total: sql<string>`sum(${I.total})::bigint`,
    })
    .from(I)
    .innerJoin(D, eq(D.id, I.dayId))
    .where(
      and(inArray(I.dayId, dayIds), trendScope(I, viewer, includeVehicles)),
    )
    .groupBy(I.dayId, I.prefab, shared);
}

/** SUM(total) per (day, base, prefab, shared) — base centroid kept for OPEN-1. */
export function selectTrendBaseSums(
  db: Exec,
  dayIds: number[],
  viewer: MaterialsViewer,
  includeVehicles: boolean,
): Promise<TrendBaseSumRow[]> {
  const shared = sharedOf(B);
  return db
    .select({
      dayId: B.dayId,
      baseKey: B.baseKey,
      baseX: B.baseX,
      baseZ: B.baseZ,
      prefab: B.prefab,
      shared,
      total: sql<string>`sum(${B.total})::bigint`,
    })
    .from(B)
    .innerJoin(D, eq(D.id, B.dayId))
    .where(
      and(inArray(B.dayId, dayIds), trendScope(B, viewer, includeVehicles)),
    )
    .groupBy(B.dayId, B.baseKey, B.baseX, B.baseZ, B.prefab, shared);
}

/** Headers first; fewer than two days → no trend, so no sums are read. */
export async function selectTrendInputs(
  db: Exec,
  serverId: number,
  worldUid: string,
  viewer: MaterialsViewer,
  includeVehicles: boolean,
): Promise<TrendInputs> {
  const days = await selectTrendDays(db, serverId, worldUid, TREND_HEADER_DAYS);
  if (days.length < 2) return { days, items: [], bases: [] };
  const ids = days.map((d) => d.id);
  const [items, bases] = await Promise.all([
    selectTrendItemSums(db, ids, viewer, includeVehicles),
    selectTrendBaseSums(db, ids, viewer, includeVehicles),
  ]);
  return { days, items, bases };
}
