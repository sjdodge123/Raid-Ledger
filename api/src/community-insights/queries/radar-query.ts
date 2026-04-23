import type { CommunityRadarResponseDto } from '@raid-ledger/contract';
import type { CommunityInsightsService } from '../community-insights.service';

export async function getRadarResponse(
  service: CommunityInsightsService,
): Promise<CommunityRadarResponseDto | null> {
  const row = await service.readLatestSnapshot();
  if (!row) return null;
  return row.radarPayload;
}
