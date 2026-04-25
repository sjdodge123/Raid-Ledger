import type { CommunityChurnResponseDto } from '@raid-ledger/contract';
import type { CommunityInsightsService } from '../community-insights.service';

export async function getChurnResponse(
  service: CommunityInsightsService,
  thresholdOverride?: number,
): Promise<CommunityChurnResponseDto | null> {
  const row = await service.readLatestSnapshot();
  if (!row) return null;
  const stored = row.churnPayload;
  if (thresholdOverride === undefined) return stored;
  const atRisk = stored.candidates.filter(
    (c) => c.dropPct >= thresholdOverride,
  );
  return {
    ...stored,
    thresholdPct: thresholdOverride,
    atRisk,
  };
}
