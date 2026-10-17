import type { CommunityKeyInsightsResponseDto } from '@raid-ledger/contract';
import type { CommunityInsightsService } from '../community-insights.service';

export async function getKeyInsightsResponse(
  service: CommunityInsightsService,
): Promise<CommunityKeyInsightsResponseDto | null> {
  const row = await service.readLatestSnapshot();
  if (!row) return null;
  return row.keyInsightsPayload;
}
