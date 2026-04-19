/**
 * Pure-math helpers for Common Ground taste/social/intensity scoring
 * (ROK-950). All exports are side-effect-free so they can be unit-tested
 * in isolation and reused by any caller that wants to compute an
 * individual score factor.
 */
import {
  TASTE_PROFILE_AXIS_POOL,
  type TasteProfilePoolAxis,
} from '@raid-ledger/contract';
import { AXIS_MAPPINGS } from '../taste-profile/axis-mapping.constants';

/**
 * Cosine similarity between two equal-length numeric vectors.
 * Returns 0 on length mismatch or when either input is the zero vector.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Element-wise mean of a list of equal-length vectors. Returns null for
 * an empty input so callers can short-circuit a downstream cosine.
 */
export function computeCombinedVoterVector(
  vectors: number[][],
): number[] | null {
  if (vectors.length === 0) return null;
  if (vectors.length === 1) return [...vectors[0]];
  const len = vectors[0].length;
  const result = new Array<number>(len).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < len; i++) result[i] += v[i];
  }
  for (let i = 0; i < len; i++) result[i] /= vectors.length;
  return result;
}

/**
 * Lowercased tag lookup set per pool axis — built once at module load.
 * Enables O(1) membership check per game tag.
 */
const AXIS_TAG_SETS: Record<TasteProfilePoolAxis, Set<string>> = (() => {
  const out = {} as Record<TasteProfilePoolAxis, Set<string>>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    out[axis] = new Set(AXIS_MAPPINGS[axis].tags.map((t) => t.toLowerCase()));
  }
  return out;
})();

/**
 * Map a game's ITAD/Steam tag list to a full-pool taste vector. Each axis
 * contributes 1.0 if any of the game's tags match the axis's tag list,
 * 0 otherwise. Tag matching is case-insensitive. Non-tag axis fields
 * (gameModes/genres/themes) are not consulted here because Common Ground
 * rows only carry the ITAD tag set.
 */
export function gameToTasteVector(itadTags: string[]): number[] {
  const lowered = new Set(itadTags.map((t) => t.toLowerCase()));
  const vec = new Array<number>(TASTE_PROFILE_AXIS_POOL.length).fill(0);
  for (let i = 0; i < TASTE_PROFILE_AXIS_POOL.length; i++) {
    const axis = TASTE_PROFILE_AXIS_POOL[i];
    for (const tag of AXIS_TAG_SETS[axis]) {
      if (lowered.has(tag)) {
        vec[i] = 1;
        break;
      }
    }
  }
  return vec;
}

/**
 * Taste score = cosine(game, voter) * weight. Returns 0 when either input
 * is null/zero so callers need not short-circuit themselves.
 */
export function computeTasteScore(
  gameVec: number[],
  voterVec: number[] | null,
  weight: number,
): number {
  if (voterVec === null) return 0;
  const sim = cosineSimilarity(gameVec, voterVec);
  if (sim === 0) return 0;
  return sim * weight;
}

/** Game descriptor for the social-score helper. */
export interface SocialScoreGame {
  ownerIds: Set<number>;
}

/**
 * Social score = `weight` when any co-play partner also owns the game,
 * 0 otherwise. Empty partner set always yields 0.
 */
export function computeSocialScore(
  game: SocialScoreGame,
  partnerIds: Set<number>,
  weight: number,
): number {
  if (partnerIds.size === 0) return 0;
  for (const id of game.ownerIds) {
    if (partnerIds.has(id)) return weight;
  }
  return 0;
}

/** Intensity bucket used by the intensity-fit helper. */
export type IntensityBucket = 'low' | 'medium' | 'high';

/** Game descriptor for the intensity-fit helper. */
export interface IntensityFitGame {
  intensityBucket: IntensityBucket | null;
}

/**
 * Intensity fit score = `weight` when the voter's preferred bucket
 * matches the game's bucket, 0 otherwise. Null voter intensity returns 0.
 */
export function computeIntensityFit(
  game: IntensityFitGame,
  voterIntensity: IntensityBucket | null,
  weight: number,
): number {
  if (voterIntensity === null) return 0;
  if (game.intensityBucket === null) return 0;
  return game.intensityBucket === voterIntensity ? weight : 0;
}
