/**
 * Helpers for assembling the Common Ground scoring context (ROK-950).
 *
 * Separated from `lineups.service.ts` so the data-gathering / math path
 * stays testable and under the 30-lines-per-function budget.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  CommonGroundQueryDto,
  CommonGroundResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import {
  countDistinctNominators,
  findBuildingLineup,
  findCoPlayPartnerIds,
  findLineupById,
  findLineupVoterIds,
  findNominatedGameIds,
} from './lineups-query.helpers';
import { loadInvitees } from './lineups-eligibility.helpers';
import { computeCombinedVoterVector } from './common-ground-taste.helpers';
import type { IntensityBucket } from './common-ground-taste.helpers';
import {
  buildCommonGroundResponse,
  type ScoringContext,
} from './common-ground-query.helpers';

/**
 * Classify a voter's average intensity metric into a bucket. Mirrors the
 * game-side heuristic so the intensity-fit helper can compare apples to
 * apples.
 *
 * The 33/33/33 percentile tiling (≥67 / ≥34 / rest) is fixed by design:
 * it preserves mirror-side symmetry with the game-side `deriveGameIntensity`
 * bucket thresholds and keeps the voter/game spaces comparable. These
 * thresholds are intentionally NOT elevated to `CommonGroundWeights` — a
 * configurable split would break that symmetry.
 */
function intensityToBucket(avgIntensity: number): IntensityBucket {
  if (avgIntensity >= 67) return 'high';
  if (avgIntensity >= 34) return 'medium';
  return 'low';
}

/**
 * Resolve the full scoring context for a lineup. Returns null vectors /
 * empty sets / null intensity when nothing is available so downstream
 * scoring gracefully zeroes the new factors.
 */
export async function buildScoringContext(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
  tasteProfile: TasteProfileService,
  settings: SettingsService,
  // ROK-1348: voterIds is fetched once by the caller and shared with
  // resolveParticipantCount (public branch) to avoid a duplicate query.
  voterIds: number[],
): Promise<ScoringContext> {
  const weights = await settings.getCommonGroundWeights();
  if (voterIds.length === 0) {
    return {
      voterVector: null,
      coPlayPartnerIds: new Set(),
      voterIntensity: null,
      weights,
    };
  }
  const vectorMap = await tasteProfile.getTasteVectorsForUsers(voterIds);
  const vectors = [...vectorMap.values()].map((v) => v.vector);
  const voterVector = computeCombinedVoterVector(vectors);
  const voterIntensity = averageIntensityBucket(vectorMap);
  const coPlayPartnerIds = await findCoPlayPartnerIds(db, voterIds);
  return { voterVector, coPlayPartnerIds, voterIntensity, weights };
}

/** Compute the mean intensity across resolved vectors, or null if none. */
function averageIntensityBucket(
  vectorMap: Map<number, { intensityMetrics: { intensity: number } }>,
): IntensityBucket | null {
  if (vectorMap.size === 0) return null;
  let sum = 0;
  for (const v of vectorMap.values()) sum += v.intensityMetrics.intensity;
  return intensityToBucket(sum / vectorMap.size);
}

/**
 * Resolve the lineup to score Common Ground against (ROK-1065).
 * Prefers `filters.lineupId` when the client specifies one — required for
 * multi-lineup UIs (Schedule-a-Game picker, private-lineup pages) so the
 * response reflects the lineup the user is viewing. Falls back to the
 * newest building lineup when omitted. 400s when the requested lineup
 * exists but isn't in building status; 404s when neither path finds one.
 */
async function resolveScoringLineup(
  db: PostgresJsDatabase<typeof schema>,
  filters: CommonGroundQueryDto,
): Promise<{ id: number; visibility: 'public' | 'private' }> {
  if (filters.lineupId != null) {
    const [row] = await findLineupById(db, filters.lineupId);
    if (!row) throw new NotFoundException('Lineup not found');
    if (row.status !== 'building') {
      throw new BadRequestException('Lineup is not in building status');
    }
    return { id: row.id, visibility: row.visibility };
  }
  const [lineup] = await findBuildingLineup(db);
  if (!lineup)
    throw new NotFoundException('No active lineup in building status');
  return { id: lineup.id, visibility: lineup.visibility };
}

/**
 * Resolve voting-eligibility size for the nomination-phase filter (ROK-1255).
 * Private: creator + invitees (one row per invitee, plus the creator).
 * Public: union of voters + nominators + creator, mirroring `findLineupVoterIds`.
 */
async function resolveParticipantCount(
  db: PostgresJsDatabase<typeof schema>,
  lineup: { id: number; visibility: 'public' | 'private' },
  // ROK-1348: reuse the voterIds buildScoringContext already fetched for
  // the public branch instead of querying findLineupVoterIds a second time.
  voterIds: number[],
): Promise<number> {
  if (lineup.visibility === 'private') {
    const invitees = await loadInvitees(db, lineup.id);
    return invitees.length + 1;
  }
  return voterIds.length;
}

/**
 * Orchestrate the full Common Ground query for a building lineup.
 * Honors `filters.lineupId` (ROK-1065) so multi-lineup UIs can target the
 * lineup the user is currently viewing instead of always scoring against
 * the newest building row.
 */
export async function runCommonGroundForBuildingLineup(
  db: PostgresJsDatabase<typeof schema>,
  filters: CommonGroundQueryDto,
  tasteProfile: TasteProfileService,
  settings: SettingsService,
): Promise<CommonGroundResponseDto> {
  const lineup = await resolveScoringLineup(db, filters);
  const nominated = await findNominatedGameIds(db, lineup.id);
  const [nominators] = await countDistinctNominators(db, lineup.id);
  // ROK-1348: single voterIds fetch, shared between the scoring context and
  // the public-branch participant count (was queried twice before).
  const voterIds = await findLineupVoterIds(db, lineup.id);
  const participantCount = await resolveParticipantCount(db, lineup, voterIds);
  const ctx = await buildScoringContext(
    db,
    lineup.id,
    tasteProfile,
    settings,
    voterIds,
  );
  return buildCommonGroundResponse(
    db,
    lineup.id,
    nominated,
    nominators?.count ?? 0,
    participantCount,
    filters,
    ctx,
  );
}
