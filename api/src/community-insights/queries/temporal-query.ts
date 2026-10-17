import type { CommunityTemporalResponseDto } from '@raid-ledger/contract';
import type { CommunityInsightsService } from '../community-insights.service';

export async function getTemporalResponse(
  service: CommunityInsightsService,
): Promise<CommunityTemporalResponseDto | null> {
  const row = await service.readLatestSnapshot();
  if (!row) return null;
  return row.temporalPayload;
}
