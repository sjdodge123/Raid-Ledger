import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CrosswalkContributionBatchSchema,
  HUB_SCHEMA_VERSION,
  type CrosswalkContributionBatch,
  type CrosswalkContributionResponse,
  type CrosswalkContributionResult,
} from '@raid-ledger/contract';
import { HubBearerGuard, type HubAuth } from '../auth/bearer.guard';
import { HubInstance } from '../auth/hub-instance.decorator';
import { hubError } from '../common/hub-errors';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { ContributorGuard } from './contributor.guard';
import { CrosswalkMatcherService } from './crosswalk-matcher.service';

const COUNTED = ['created', 'matched', 'attached', 'conflict'] as const;

/** L8: counts only, never a name or an id value. */
export function batchLogLine(
  instanceId: string,
  results: readonly CrosswalkContributionResult[],
): string {
  const counts = COUNTED.map(
    (r) => `${r}=${results.filter((x) => x.result === r).length}`,
  );
  return `contributions instance=${instanceId} items=${results.length} ${counts.join(' ')}`;
}

/** `POST /api/v1/crosswalk/contributions` (ROK-1674 L1-L3, L8). No throttle (D1). */
@Controller('v1/crosswalk')
@UseGuards(HubBearerGuard, ContributorGuard)
export class ContributionsController {
  private readonly logger = new Logger(ContributionsController.name);

  constructor(private readonly matcher: CrosswalkMatcherService) {}

  /** The whole batch is validated before any item is matched (L2). */
  @Post('contributions')
  @HttpCode(200)
  async contribute(
    @HubInstance() auth: HubAuth,
    @Body(new ZodBodyPipe(CrosswalkContributionBatchSchema))
    body: CrosswalkContributionBatch,
  ): Promise<CrosswalkContributionResponse> {
    if (body.schemaVersion !== HUB_SCHEMA_VERSION) {
      throw hubError(
        426,
        'schema_unsupported',
        `serves schemaVersion ${HUB_SCHEMA_VERSION}`,
      );
    }
    const results = await this.matcher.matchBatch(auth.instanceId, body.items);
    this.logger.log(batchLogLine(auth.instanceId, results));
    return { schemaVersion: HUB_SCHEMA_VERSION, results };
  }
}
