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

/**
 * Community default timezone → the zone the heatmap buckets in. A missing,
 * blank or unknown zone falls back to UTC so a bad setting can never break
 * the nightly refresh (ROK-1936).
 */
export function resolveHeatmapTimezone(raw: string | null | undefined): string {
  const tz = raw?.trim() ?? '';
  return isValidIanaTimezone(tz) ? tz : FALLBACK_TIMEZONE;
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
  const timezone = resolveHeatmapTimezone(rawTimezone);
  const heatmap = await loadHeatmap(db, timezone);
  const peakHours = computePeakHours(heatmap);
  return { snapshotDate, heatmap, peakHours, timezone };
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
