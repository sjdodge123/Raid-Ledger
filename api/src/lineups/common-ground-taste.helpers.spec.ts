/**
 * Unit tests for Common Ground taste-scoring helpers (ROK-950).
 *
 * These helpers are pure math: cosine similarity, voter-vector aggregation,
 * per-axis taste/social/intensity scoring. Written TDD-style BEFORE the
 * helpers exist — every test here must FAIL on first run either by failing
 * compilation (missing module) or by failing assertions.
 *
 * ACs covered here (pure-math primitives underpinning the wider ACs):
 * - AC 4: Common Ground sort factors in taste, social, intensity
 * - AC 5: tuning works without an AI provider (these are the math pieces)
 * - AC 7: graceful degradation — null voter vec, empty partner set, etc.
 */
import { TASTE_PROFILE_AXIS_POOL } from '@raid-ledger/contract';
import {
  cosineSimilarity,
  computeCombinedVoterVector,
  gameToTasteVector,
  computeTasteScore,
  computeSocialScore,
  computeIntensityFit,
} from './common-ground-taste.helpers';

describe('cosineSimilarity', () => {
  it('returns 1.0 for parallel vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 5);
  });

  it('returns ~0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it('returns 0 for a zero-vector input', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('returns 0 on length mismatch rather than throwing', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe('computeCombinedVoterVector', () => {
  it('returns null for an empty vector list', () => {
    expect(computeCombinedVoterVector([])).toBeNull();
  });

  it('returns the input vector when only one is supplied', () => {
    const v = [1, 2, 3, 4, 5, 6, 7];
    const result = computeCombinedVoterVector([v]);
    expect(result).not.toBeNull();
    expect(result).toEqual(v);
  });

  it('returns an element-wise average of multiple vectors', () => {
    const v1 = [2, 4, 6];
    const v2 = [4, 6, 8];
    const result = computeCombinedVoterVector([v1, v2]);
    expect(result).not.toBeNull();
    expect(result![0]).toBeCloseTo(3, 5);
    expect(result![1]).toBeCloseTo(5, 5);
    expect(result![2]).toBeCloseTo(7, 5);
  });
});

describe('gameToTasteVector', () => {
  it('returns a zero vector (length equal to axis pool) when no tags match', () => {
    const vec = gameToTasteVector([]);
    expect(vec).toHaveLength(TASTE_PROFILE_AXIS_POOL.length);
    for (const v of vec) expect(v).toBe(0);
  });

  it('sets a non-zero value on the pvp axis for pvp-tagged games', () => {
    const vec = gameToTasteVector(['PvP', 'Shooter']);
    const pvpIdx = TASTE_PROFILE_AXIS_POOL.indexOf('pvp');
    expect(pvpIdx).toBeGreaterThanOrEqual(0);
    expect(vec[pvpIdx]).toBeGreaterThan(0);
  });

  it('sets a non-zero value on the co_op axis for co-op-tagged games', () => {
    const vec = gameToTasteVector(['Co-op', 'Online Co-Op']);
    const coopIdx = TASTE_PROFILE_AXIS_POOL.indexOf('co_op');
    expect(coopIdx).toBeGreaterThanOrEqual(0);
    expect(vec[coopIdx]).toBeGreaterThan(0);
  });

  it('leaves non-matching axes at zero', () => {
    const vec = gameToTasteVector(['PvP']);
    const racingIdx = TASTE_PROFILE_AXIS_POOL.indexOf('racing');
    expect(vec[racingIdx]).toBe(0);
  });
});

describe('computeTasteScore', () => {
  const weight = 10;

  it('returns 0 when voter vector is null (graceful — AC 7)', () => {
    const gameVec = gameToTasteVector(['PvP']);
    expect(computeTasteScore(gameVec, null, weight)).toBe(0);
  });

  it('returns 0 when both vectors are empty / zero', () => {
    const zeros = new Array(TASTE_PROFILE_AXIS_POOL.length).fill(0);
    expect(computeTasteScore(zeros, zeros, weight)).toBe(0);
  });

  it('returns ~weight for a game that perfectly matches the voter vector', () => {
    const gameVec = gameToTasteVector(['PvP']);
    // Voter vector uses the same axis — cosine similarity ≈ 1
    const voterVec = [...gameVec];
    const score = computeTasteScore(gameVec, voterVec, weight);
    expect(score).toBeCloseTo(weight, 5);
  });

  it('returns 0 for orthogonal game/voter axes', () => {
    const gameVec = gameToTasteVector(['PvP']);
    const voterVec = gameToTasteVector(['Racing']);
    const score = computeTasteScore(gameVec, voterVec, weight);
    expect(score).toBeCloseTo(0, 5);
  });
});

describe('computeSocialScore', () => {
  const weight = 5;

  it('returns 0 when partner set is empty (AC 7)', () => {
    const game = { ownerIds: new Set<number>([1, 2, 3]) };
    expect(computeSocialScore(game, new Set<number>(), weight)).toBe(0);
  });

  it('returns weight when any owner is a co-play partner', () => {
    const game = { ownerIds: new Set<number>([1, 2, 3]) };
    const partners = new Set<number>([2, 99]);
    expect(computeSocialScore(game, partners, weight)).toBe(weight);
  });

  it('returns 0 when no owner overlaps with partner set', () => {
    const game = { ownerIds: new Set<number>([1, 2, 3]) };
    const partners = new Set<number>([99, 100]);
    expect(computeSocialScore(game, partners, weight)).toBe(0);
  });
});

describe('computeIntensityFit', () => {
  const weight = 4;

  it('returns 0 when voter intensity is null (graceful — AC 7)', () => {
    const game = { intensityBucket: 'medium' as const };
    expect(computeIntensityFit(game, null, weight)).toBe(0);
  });

  it('returns weight when voter intensity bucket matches game bucket', () => {
    const game = { intensityBucket: 'high' as const };
    expect(computeIntensityFit(game, 'high', weight)).toBe(weight);
  });

  it('returns 0 when voter intensity bucket does not match', () => {
    const game = { intensityBucket: 'low' as const };
    expect(computeIntensityFit(game, 'high', weight)).toBe(0);
  });
});
