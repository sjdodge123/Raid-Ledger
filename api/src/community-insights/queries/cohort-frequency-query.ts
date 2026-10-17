import type { CohortGameFrequencyResponseDto } from '@raid-ledger/contract';
import type { CommunityInsightsService } from '../community-insights.service';
import type { CohortFrequencyMode } from '../pipelines/cohort-frequency-section';

/**
 * Default top-N per bucket. Matches the panel's column budget; the UI keeps
 * its own constant so the two can diverge without a contract change.
 */
export const COHORT_FREQUENCY_TOP_N = 5;

/**
 * Unlike its snapshot-backed siblings this never returns `null`: the
 * aggregation reads a live table, so "no rows yet" is an empty payload and
 * the controller must NOT wrap it in `assertSnapshot`.
 */
export async function getCohortGameFrequencyResponse(
  service: CommunityInsightsService,
  mode: CohortFrequencyMode,
): Promise<CohortGameFrequencyResponseDto> {
  return service.readCohortGameFrequency(mode, COHORT_FREQUENCY_TOP_N);
}
