import { desc, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CommunityRadarResponseDto,
  TasteDriftPointDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The two snapshot columns drift stitching reads. */
export type DriftSourceRow = Pick<
  typeof schema.communityInsightsSnapshots.$inferSelect,
  'snapshotDate' | 'radarPayload'
>;

export const DRIFT_WEEK_COUNT = 8;
// 56 = worst case where every day in 8 weeks has its own snapshot row;
// dedupe-by-week collapses that to 8 points.
export const DRIFT_SNAPSHOT_LIMIT = DRIFT_WEEK_COUNT * 7;

/**
 * Collapse newest-first snapshot rows into one drift entry per ISO week:
 * keep the first (= latest) snapshot per week, cap to the most recent
 * `weekCap` weeks, and re-stamp each point with the Monday-of-week date so
 * multi-day snapshots group into a single weekly point (ROK-1280).
 */
export function mergeWeeklyDrift(
  rows: DriftSourceRow[],
  weekCap: number,
): TasteDriftPointDto[] {
  const byWeek = new Map<string, DriftSourceRow>();
  for (const row of rows) {
    const weekStart = isoWeekStart(toDateString(row.snapshotDate));
    if (!byWeek.has(weekStart)) byWeek.set(weekStart, row);
  }
  const weeks = Array.from(byWeek.keys()).sort().slice(-weekCap);
  return weeks.flatMap((weekStart) => {
    const row = byWeek.get(weekStart);
    if (!row) return [];
    return row.radarPayload.driftSeries.map((p) => ({ ...p, weekStart }));
  });
}

/**
 * The radar handed to key-insight generation during a refresh: the fresh
 * radar with its `driftSeries` widened to up to 8 ISO weeks, so the
 * week-over-week genre-shift rule has a prior week to compare against.
 * The current snapshot wins its own week; `priorRows` (newest-first,
 * strictly older dates) supply the earlier weeks. Never persisted — the
 * stored payload keeps its single-week series.
 */
export function stitchDriftForInsights(
  priorRows: DriftSourceRow[],
  current: CommunityRadarResponseDto,
  snapshotDate: string,
): CommunityRadarResponseDto {
  const rows = [{ snapshotDate, radarPayload: current }, ...priorRows];
  return {
    ...current,
    driftSeries: mergeWeeklyDrift(rows, DRIFT_WEEK_COUNT),
  };
}

/** Radar payloads of snapshots dated before `snapshotDate`, newest-first. */
export async function readPriorRadarRows(
  db: Db,
  snapshotDate: string,
): Promise<DriftSourceRow[]> {
  const t = schema.communityInsightsSnapshots;
  return db
    .select({ snapshotDate: t.snapshotDate, radarPayload: t.radarPayload })
    .from(t)
    .where(lt(t.snapshotDate, snapshotDate))
    .orderBy(desc(t.snapshotDate))
    .limit(DRIFT_SNAPSHOT_LIMIT);
}

/** Drizzle's `date` column may surface as string or Date; normalize. */
function toDateString(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `dateStr`, as `YYYY-MM-DD` (UTC). */
export function isoWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
