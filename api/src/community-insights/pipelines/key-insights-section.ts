import type {
  CommunityChurnResponseDto,
  CommunityEngagementResponseDto,
  CommunityKeyInsightsResponseDto,
  CommunityRadarResponseDto,
  CommunitySocialGraphResponseDto,
  CommunityTemporalResponseDto,
} from '@raid-ledger/contract';
import type { KeyInsightsService } from '../key-insights.service';

export function buildKeyInsightsSection(
  service: KeyInsightsService,
  snapshotDate: string,
  sections: {
    radar: CommunityRadarResponseDto;
    engagement: CommunityEngagementResponseDto;
    churn: CommunityChurnResponseDto;
    socialGraph: CommunitySocialGraphResponseDto;
    temporal: CommunityTemporalResponseDto;
  },
): CommunityKeyInsightsResponseDto {
  const insights = service.generateInsights(sections);
  return { snapshotDate, insights };
}
