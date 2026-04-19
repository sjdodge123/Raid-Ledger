/**
 * Helpers for assembling the Common Ground scoring context (ROK-950).
 *
 * Separated from `lineups.service.ts` so the data-gathering / math path
 * stays testable and under the 30-lines-per-function budget.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import {
  findCoPlayPartnerIds,
  findLineupVoterIds,
} from './lineups-query.helpers';
import { computeCombinedVoterVector } from './common-ground-taste.helpers';
import type { IntensityBucket } from './common-ground-taste.helpers';
import type { ScoringContext } from './common-ground-query.helpers';

/**
 * Classify a voter's average intensity metric into a bucket. Mirrors the
 * game-side heuristic so the intensity-fit helper can compare apples to
 * apples.
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
): Promise<ScoringContext> {
  const weights = await settings.getCommonGroundWeights();
  const voterIds = await findLineupVoterIds(db, lineupId);
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
