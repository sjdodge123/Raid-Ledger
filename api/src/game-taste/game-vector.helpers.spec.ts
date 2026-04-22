/**
 * Unit tests for per-game taste vector computation (ROK-1082).
 *
 * Written TDD-style BEFORE the feature is implemented — every test here
 * must FAIL on first run. The dev agent builds to make them pass.
 *
 * Covers:
 * - `computeAxisIdf(gameMap)` — per-axis rarity weighting
 * - `computeGameVector(metadata, signals, corpusStats, axisIdf)` — full
 *   output shape: { dimensions, vector, confidence, derivation }
 * - Tag priority vs IGDB fallback
 * - Zero-signal → zero vector + confidence = 0
 * - Derivation payload populated per axis
 */
import {
  computeAxisIdf,
  computeGameVector,
  type GameMetadata,
  type GameSignals,
  type CorpusStats,
} from './game-vector.helpers';

function meta(overrides: Partial<GameMetadata> = {}): GameMetadata {
  return {
    gameId: 1,
    genres: [],
    gameModes: [],
    themes: [],
    tags: [],
    ...overrides,
  };
}

function signals(overrides: Partial<GameSignals> = {}): GameSignals {
  return {
    gameId: 1,
    playtimeSeconds: 0,
    interestCount: 0,
    ...overrides,
  };
}

const baseCorpus: CorpusStats = {
  maxPlaytimeSeconds: 100_000,
  maxInterestCount: 10,
};

describe('computeAxisIdf (ROK-1082)', () => {
  it('returns ln((N+1)/(coverage+1))+1 per axis', () => {
    // Corpus: one survival game + one co_op game — so survival has
    // coverage=1, co_op coverage=1, others coverage=0.
    const games = new Map<number, GameMetadata>([
      [1, meta({ gameId: 1, tags: ['survival'] })],
      [2, meta({ gameId: 2, gameModes: [3] /* Coop */ })],
    ]);
    const idf = computeAxisIdf(games);
    const n = 2;
    // survival and co_op both have coverage 1
    const expectedCovered = Math.log((n + 1) / (1 + 1)) + 1;
    // Zero-coverage axes — use uncovered axis as baseline
    const expectedUncovered = Math.log((n + 1) / (0 + 1)) + 1;
    expect(idf.survival).toBeCloseTo(expectedCovered, 5);
    expect(idf.co_op).toBeCloseTo(expectedCovered, 5);
    // An axis nothing hits should be at the uncovered bound
    expect(idf.mmo).toBeCloseTo(expectedUncovered, 5);
  });

  it('is stable on a small corpus (Laplace smoothing — never divides by zero)', () => {
    const games = new Map<number, GameMetadata>();
    const idf = computeAxisIdf(games);
    for (const axis of Object.keys(idf)) {
      expect(Number.isFinite(idf[axis as keyof typeof idf])).toBe(true);
    }
  });
});

describe('computeGameVector output shape (ROK-1082)', () => {
  it('returns { dimensions, vector, confidence, derivation }', () => {
    const games = new Map<number, GameMetadata>([
      [1, meta({ gameId: 1, tags: ['survival'] })],
    ]);
    const idf = computeAxisIdf(games);

    const out = computeGameVector(
      meta({ gameId: 1, tags: ['survival'] }),
      signals({ gameId: 1, playtimeSeconds: 50_000, interestCount: 3 }),
      baseCorpus,
      idf,
    );

    expect(out).toEqual(
      expect.objectContaining({
        dimensions: expect.any(Object),
        vector: expect.any(Array),
        confidence: expect.any(Number),
        derivation: expect.any(Array),
      }),
    );
    expect(out.vector).toHaveLength(7);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });
});

describe('tag priority vs IGDB fallback (ROK-1082)', () => {
  it('ITAD tag match takes priority over IGDB IDs when both present', () => {
    // A game tagged with "survival" but with IGDB gameMode 3 (Coop).
    // With tags present, axisMatchFactor uses tags only — so co_op
    // should NOT match via the IGDB fallback.
    const gMeta = meta({
      gameId: 1,
      tags: ['survival'],
      gameModes: [3],
    });
    const games = new Map<number, GameMetadata>([[1, gMeta]]);
    const idf = computeAxisIdf(games);

    const out = computeGameVector(
      gMeta,
      signals({ gameId: 1, playtimeSeconds: 10_000, interestCount: 2 }),
      baseCorpus,
      idf,
    );
    expect(out.dimensions.survival).toBeGreaterThan(0);
    expect(out.dimensions.co_op).toBe(0);
  });

  it('IGDB fallback activates when tags is empty', () => {
    // No tags, but IGDB gameMode 3 (Coop) — co_op axis should match
    // via fallback.
    const gMeta = meta({ gameId: 1, gameModes: [3] });
    const games = new Map<number, GameMetadata>([[1, gMeta]]);
    const idf = computeAxisIdf(games);

    const out = computeGameVector(
      gMeta,
      signals({ gameId: 1, playtimeSeconds: 10_000, interestCount: 2 }),
      baseCorpus,
      idf,
    );
    expect(out.dimensions.co_op).toBeGreaterThan(0);
  });
});

describe('zero-signal fallback (ROK-1082 plan §Risks line 331)', () => {
  it('returns a zero vector + confidence=0 for a game with no signals and no metadata', () => {
    const gMeta = meta({ gameId: 7 });
    const games = new Map<number, GameMetadata>([[7, gMeta]]);
    const idf = computeAxisIdf(games);

    const out = computeGameVector(
      gMeta,
      signals({ gameId: 7 }),
      baseCorpus,
      idf,
    );
    expect(out.vector.every((v: number) => v === 0)).toBe(true);
    expect(out.confidence).toBe(0);
    for (const v of Object.values(out.dimensions)) {
      expect(v).toBe(0);
    }
  });
});

describe('derivation payload (ROK-1082 §Debug payload depth)', () => {
  it('includes matchedTags, matchedGenreIds, matchedModeIds, matchedThemeIds, playSignal, idfWeight, rawScore, normalizedScore per axis', () => {
    const gMeta = meta({
      gameId: 1,
      tags: ['survival'],
      genres: [12],
      gameModes: [3],
      themes: [17],
    });
    const games = new Map<number, GameMetadata>([[1, gMeta]]);
    const idf = computeAxisIdf(games);

    const out = computeGameVector(
      gMeta,
      signals({ gameId: 1, playtimeSeconds: 30_000, interestCount: 2 }),
      baseCorpus,
      idf,
    );

    expect(out.derivation.length).toBeGreaterThan(0);
    // Find the survival axis entry (there MUST be one since we tagged it)
    const survival = out.derivation.find(
      (d: { axis: string }) => d.axis === 'survival',
    );
    expect(survival).toBeDefined();
    expect(survival).toEqual(
      expect.objectContaining({
        axis: 'survival',
        matchedTags: expect.any(Array),
        matchedGenreIds: expect.any(Array),
        matchedModeIds: expect.any(Array),
        matchedThemeIds: expect.any(Array),
        playSignal: expect.any(Number),
        idfWeight: expect.any(Number),
        rawScore: expect.any(Number),
        normalizedScore: expect.any(Number),
      }),
    );
    // The matched tag we supplied should surface in matchedTags for the
    // axis that consumed it.
    expect(survival!.matchedTags.length).toBeGreaterThan(0);
  });
});
