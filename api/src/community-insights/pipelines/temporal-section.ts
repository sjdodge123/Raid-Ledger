import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  isValidIanaTimezone,
  type CommunityTemporalResponseDto,
  type PeakHourEntryDto,
  type TemporalHeatmapCellDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { NOW_UTC } from '../../drizzle/timestamp-utils';

type Db = PostgresJsDatabase<typeof schema>;

const PEAK_HOURS_PER_WEEKDAY = 3;
const WINDOW_DAYS = 30;
const FALLBACK_TIMEZONE = 'UTC';
const logger = new Logger('TemporalSection');

/**
 * Community default timezone → the zone the heatmap buckets in (ROK-1936).
 * Accepts only `UTC` or an IANA `Area/Location` name, after Intl
 * canonicalisation. Anything else — missing, blank, unknown, a bare
 * offset string like `+05:00` (Postgres reads that as
 * POSIX, sign flipped) — falls back to UTC so a bad setting can never break
 * or silently skew the nightly refresh.
 */
export function resolveHeatmapTimezone(raw: string | null | undefined): string {
  const tz = raw?.trim() ?? '';
  if (!isValidIanaTimezone(tz)) return FALLBACK_TIMEZONE;
  const canonical = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
  }).resolvedOptions().timeZone;
  const accepted = canonical === FALLBACK_TIMEZONE || canonical.includes('/');
  return accepted ? canonical : FALLBACK_TIMEZONE;
}

/**
 * Temporal payload: 7×24 heatmap of voice-join counts over the last 30
 * days plus top-N peak hours per weekday, bucketed in the community
 * default timezone (`rawTimezone`, UTC when unset/invalid). Uses Postgres
 * `isodow` so Monday=1…Sunday=7.
 */
export async function buildTemporalSection(
  db: Db,
  snapshotDate: string,
  rawTimezone?: string | null,
): Promise<CommunityTemporalResponseDto> {
  const resolved = resolveHeatmapTimezone(rawTimezone);
  const { heatmap, timezone } = await loadHeatmapWithFallback(db, resolved);
  const peakHours = computePeakHours(heatmap);
  return { snapshotDate, heatmap, peakHours, timezone };
}

/**
 * Runs the heatmap query in `timezone`; if Postgres rejects the zone (an
 * ICU/tzdata skew — Intl knows it, the DB image does not) retries ONCE in
 * UTC rather than dropping the section. Safe to catch-and-retry: the query
 * runs on the pool via `db.execute`, not inside a transaction. A failure of
 * the UTC query itself propagates.
 */
async function loadHeatmapWithFallback(
  db: Db,
  timezone: string,
): Promise<{ heatmap: TemporalHeatmapCellDto[]; timezone: string }> {
  try {
    return { heatmap: await loadHeatmap(db, timezone), timezone };
  } catch (err: unknown) {
    if (timezone === FALLBACK_TIMEZONE) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Heatmap query failed for timezone "${timezone}" (${reason}); retrying in UTC`,
    );
    const heatmap = await loadHeatmap(db, FALLBACK_TIMEZONE);
    return { heatmap, timezone: FALLBACK_TIMEZONE };
  }
}

/**
 * `first_join_at` is zone-less and holds the UTC wall clock: tag it as UTC,
 * then convert to the community zone before extracting weekday + hour.
 * The window compares against NOW_UTC (same zone-less frame as the column).
 */
async function loadHeatmap(
  db: Db,
  timezone: string,
): Promise<TemporalHeatmapCellDto[]> {
  const rows = await db.execute<{
    weekday: number;
    hour: number;
    activity: number;
  }>(sql`
    SELECT
      EXTRACT(ISODOW FROM local_at)::int AS weekday,
      EXTRACT(HOUR FROM local_at)::int AS hour,
      COUNT(*)::int AS activity
    FROM (
      SELECT (first_join_at AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}::text AS local_at
      FROM event_voice_sessions
      WHERE first_join_at >= ${NOW_UTC} - (${WINDOW_DAYS}::int * interval '1 day')
    ) AS joins
    GROUP BY 1, 2
  `);
  const byCell = new Map<string, number>();
  for (const r of rows) {
    byCell.set(`${r.weekday}:${r.hour}`, Number(r.activity));
  }
  return allCells().map((cell) => ({
    ...cell,
    activity: byCell.get(`${cell.weekday}:${cell.hour}`) ?? 0,
  }));
}

function allCells(): Array<{ weekday: number; hour: number }> {
  const out: Array<{ weekday: number; hour: number }> = [];
  for (let w = 1; w <= 7; w++) {
    for (let h = 0; h < 24; h++) out.push({ weekday: w, hour: h });
  }
  return out;
}

function computePeakHours(
  heatmap: TemporalHeatmapCellDto[],
): PeakHourEntryDto[] {
  const byWeekday = new Map<number, TemporalHeatmapCellDto[]>();
  for (const cell of heatmap) {
    const list = byWeekday.get(cell.weekday) ?? [];
    list.push(cell);
    byWeekday.set(cell.weekday, list);
  }
  const out: PeakHourEntryDto[] = [];
  for (const [, cells] of byWeekday) {
    cells.sort((a, b) => b.activity - a.activity);
    for (const cell of cells.slice(0, PEAK_HOURS_PER_WEEKDAY)) {
      if (cell.activity === 0) continue;
      out.push(cell);
    }
  }
  return out;
}
