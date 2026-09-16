import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  CohortGameFrequencyQuerySchema,
  CommunityChurnQuerySchema,
  CommunitySocialGraphQuerySchema,
  type CohortGameFrequencyResponseDto,
  type CommunityChurnResponseDto,
  type CommunityEngagementResponseDto,
  type CommunityKeyInsightsResponseDto,
  type CommunityRadarResponseDto,
  type CommunityRefreshResponseDto,
  type CommunitySocialGraphResponseDto,
  type CommunityTemporalResponseDto,
} from '@raid-ledger/contract';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CommunityInsightsService } from './community-insights.service';
import { getChurnResponse } from './queries/churn-query';
import { getCohortGameFrequencyResponse } from './queries/cohort-frequency-query';
import { getEngagementResponse } from './queries/engagement-query';
import { getKeyInsightsResponse } from './queries/key-insights-query';
import { getRadarResponse } from './queries/radar-query';
import { getSocialGraphResponse } from './queries/social-graph-query';
import { getTemporalResponse } from './queries/temporal-query';

function assertSnapshot<T>(result: T | null): T {
  if (result === null) {
    throw new HttpException(
      { error: 'no_snapshot_yet' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return result;
}

@Controller('insights/community')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('operator')
export class CommunityInsightsController {
  constructor(private readonly service: CommunityInsightsService) {}

  @Get('radar')
  async radar(): Promise<CommunityRadarResponseDto> {
    return assertSnapshot(await getRadarResponse(this.service));
  }

  @Get('engagement')
  async engagement(): Promise<CommunityEngagementResponseDto> {
    return assertSnapshot(await getEngagementResponse(this.service));
  }

  @Get('churn')
  async churn(@Query() raw: unknown): Promise<CommunityChurnResponseDto> {
    const parsed = CommunityChurnQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return assertSnapshot(
      await getChurnResponse(this.service, parsed.data.thresholdPct),
    );
  }

  /**
   * ROK-1310. Deliberately NOT wrapped in `assertSnapshot`: this aggregation
   * reads the live cohort-memory table, so an empty table is a legitimate 200
   * with `buckets: []` rather than `503 no_snapshot_yet`.
   */
  @Get('cohort-game-frequency')
  async cohortGameFrequency(
    @Query() raw: unknown,
  ): Promise<CohortGameFrequencyResponseDto> {
    const parsed = CohortGameFrequencyQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return getCohortGameFrequencyResponse(this.service, parsed.data.mode);
  }

  @Get('social-graph')
  async socialGraph(
    @Query() raw: unknown,
  ): Promise<CommunitySocialGraphResponseDto> {
    const parsed = CommunitySocialGraphQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return assertSnapshot(
      await getSocialGraphResponse(this.service, parsed.data),
    );
  }

  @Get('temporal')
  async temporal(): Promise<CommunityTemporalResponseDto> {
    return assertSnapshot(await getTemporalResponse(this.service));
  }

  @Get('key-insights')
  async keyInsights(): Promise<CommunityKeyInsightsResponseDto> {
    return assertSnapshot(await getKeyInsightsResponse(this.service));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  async refresh(): Promise<CommunityRefreshResponseDto> {
    const { jobId } = await this.service.refreshSnapshot();
    return { enqueued: true, jobId };
  }
}
