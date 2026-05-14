import type {
  CommunityRadarResponseDto,
  TasteDriftPointDto,
} from '@raid-ledger/contract';
import type {
  CommunityInsightsService,
  CommunityInsightsSnapshotRow,
} from '../community-insights.service';

const DRIFT_WEEK_COUNT = 8;
// 56 = worst case where every day in 8 weeks has its own snapshot row;
// dedupe-by-week collapses that to 8 points.
const DRIFT_SNAPSHOT_LIMIT = DRIFT_WEEK_COUNT * 7;

/**
 * Radar payload for the latest snapshot, with the `driftSeries` field
 * stitched from up to 8 ISO weeks of historical snapshots so the
 * frontend's 8-week drift chart actually has multi-week data to plot
 * (ROK-1280). Each per-snapshot `driftSeries` only contains the current
 * week — we collapse daily snapshots into weekly buckets here.
 */
export async function getRadarResponse(
  service: CommunityInsightsService,
): Promise<CommunityRadarResponseDto | null> {
  const rows = await service.readRecentSnapshots(DRIFT_SNAPSHOT_LIMIT);
  if (rows.length === 0) return null;
  const latest = rows[0];
  return {
    ...latest.radarPayload,
    driftSeries: mergeWeeklyDrift(rows, DRIFT_WEEK_COUNT),
  };
}

function mergeWeeklyDrift(
  rows: CommunityInsightsSnapshotRow[],
  weekCap: number,
): TasteDriftPointDto[] {
  // Rows arrive newest-first; keep the first (= latest) snapshot per ISO
  // week, then cap to the most recent `weekCap` weeks and re-stamp each
  // point with the Monday-of-week date so the chart's X-axis groups
  // multi-day snapshots into a single weekly point.
  const byWeek = new Map<string, CommunityInsightsSnapshotRow>();
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
