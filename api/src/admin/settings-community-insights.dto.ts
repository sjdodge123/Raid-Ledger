import { IsInt, Min, Max, IsOptional } from 'class-validator';

export class CommunityInsightsSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  churnThresholdPct?: number;
}
