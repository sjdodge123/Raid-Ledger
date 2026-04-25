import type { CommunityEngagementResponseDto } from '@raid-ledger/contract';
import type { CommunityInsightsService } from '../community-insights.service';

export async function getEngagementResponse(
  service: CommunityInsightsService,
): Promise<CommunityEngagementResponseDto | null> {
  const row = await service.readLatestSnapshot();
  if (!row) return null;
  return row.engagementPayload;
}
