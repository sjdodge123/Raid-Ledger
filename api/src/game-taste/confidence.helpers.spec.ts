/**
 * Unit tests for per-game confidence scoring (ROK-1082).
 *
 * Written TDD-style BEFORE the feature is implemented — every test here
 * must FAIL on first run.
 *
 * Contract (per plan §Risks line 330):
 *   confidence ∈ [0, 1]
 *   No signals + no metadata → 0
 *   Full signals + full metadata → 1
 *   Partial → mid-range, monotonic w.r.t. increasing input strength
 */
import {
  computeConfidence,
  type GameSignals,
  type GameMetadata,
} from './confidence.helpers';

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

describe('computeConfidence (ROK-1082)', () => {
  it('returns a number in the closed interval [0, 1]', () => {
    const v = computeConfidence(
      signals({ playtimeSeconds: 5_000, interestCount: 2 }),
      meta({ tags: ['survival'] }),
    );
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('returns 0 for no signals AND no metadata', () => {
    expect(computeConfidence(signals(), meta())).toBe(0);
  });

  it('returns 1 for full signals AND full metadata', () => {
    // "Full" = enough of every axis knob to saturate the formula.
    const v = computeConfidence(
      signals({
        playtimeSeconds: 1_000_000, // vastly above any threshold
        interestCount: 1000,
      }),
      meta({
        tags: ['survival', 'co-op', 'rpg', 'pvp', 'strategy'],
        genres: [12],
        gameModes: [3],
        themes: [17],
      }),
    );
    expect(v).toBe(1);
  });

  it('returns a mid-range value for partial inputs', () => {
    const v = computeConfidence(
      signals({ playtimeSeconds: 5_000, interestCount: 1 }),
      meta({ tags: ['survival'] }),
    );
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('is monotonic — adding signal strength cannot decrease confidence', () => {
    const low = computeConfidence(
      signals({ playtimeSeconds: 1_000, interestCount: 1 }),
      meta({ tags: ['survival'] }),
    );
    const mid = computeConfidence(
      signals({ playtimeSeconds: 10_000, interestCount: 3 }),
      meta({ tags: ['survival'] }),
    );
    const high = computeConfidence(
      signals({ playtimeSeconds: 100_000, interestCount: 10 }),
      meta({
        tags: ['survival', 'co-op'],
        genres: [12],
        gameModes: [3],
        themes: [17],
      }),
    );
    expect(mid).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });
});
