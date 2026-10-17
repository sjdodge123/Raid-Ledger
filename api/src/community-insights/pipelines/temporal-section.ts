import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CommunityTemporalResponseDto,
  PeakHourEntryDto,
  TemporalHeatmapCellDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const PEAK_HOURS_PER_WEEKDAY = 3;
const WINDOW_DAYS = 30;

/**
 * Temporal payload: 7×24 heatmap of voice-join counts over the last 30
 * days plus top-N peak hours per weekday. Uses Postgres `isodow` so
 * Monday=1…Sunday=7.
 */
export async function buildTemporalSection(
  db: Db,
  snapshotDate: string,
): Promise<CommunityTemporalResponseDto> {
  const heatmap = await loadHeatmap(db);
  const peakHours = computePeakHours(heatmap);
  return { snapshotDate, heatmap, peakHours };
}

async function loadHeatmap(db: Db): Promise<TemporalHeatmapCellDto[]> {
  const rows = await db.execute<{
    weekday: number;
    hour: number;
    activity: number;
  }>(sql`
    SELECT
      EXTRACT(ISODOW FROM first_join_at)::int AS weekday,
      EXTRACT(HOUR FROM first_join_at)::int AS hour,
      COUNT(*)::int AS activity
    FROM event_voice_sessions
    WHERE first_join_at >= now() - interval '${sql.raw(String(WINDOW_DAYS))} days'
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
