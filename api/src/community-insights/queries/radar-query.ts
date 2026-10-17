import type { CommunityRadarResponseDto } from '@raid-ledger/contract';
import type { CommunityInsightsService } from '../community-insights.service';
import {
  DRIFT_SNAPSHOT_LIMIT,
  DRIFT_WEEK_COUNT,
  mergeWeeklyDrift,
} from '../pipelines/drift-history';

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
  const [latest] = rows;
  if (latest === undefined) return null;
  return {
    ...latest.radarPayload,
    driftSeries: mergeWeeklyDrift(rows, DRIFT_WEEK_COUNT),
  };
}
