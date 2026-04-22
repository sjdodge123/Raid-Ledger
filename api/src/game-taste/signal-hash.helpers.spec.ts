/**
 * Signal-hash unit tests for per-game hash fingerprint (ROK-1082).
 *
 * Written TDD-style BEFORE the feature is implemented — every test here
 * must FAIL on first run.
 *
 * Contract (per plan §Backend table row `signal-hash.helpers.ts` + spec):
 *   SHA-256 over a stable ordered concatenation of per-game signal parts.
 *   Stable across runs with identical input.
 *   Changes when any input field changes (tag hash, genre hash, mode hash,
 *   theme hash, playtime total, interest count).
 */
import {
  computeGameSignalHash,
  type GameSignalSummary,
} from './signal-hash.helpers';

describe('computeGameSignalHash (ROK-1082)', () => {
  const baseline: GameSignalSummary = {
    gameId: 42,
    playtimeTotal: 12345,
    interestCount: 7,
    tagsHash: 'tag-hash-a',
    genresHash: 'genre-hash-a',
    modesHash: 'mode-hash-a',
    themesHash: 'theme-hash-a',
  };

  it('produces the same hash for identical inputs', () => {
    expect(computeGameSignalHash(baseline)).toBe(
      computeGameSignalHash(baseline),
    );
  });

  it('produces a lowercase hex SHA-256 string (64 chars)', () => {
    expect(computeGameSignalHash(baseline)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when playtimeTotal changes', () => {
    const bumped: GameSignalSummary = { ...baseline, playtimeTotal: 99999 };
    expect(computeGameSignalHash(bumped)).not.toBe(
      computeGameSignalHash(baseline),
    );
  });

  it('changes when interestCount changes', () => {
    const bumped: GameSignalSummary = { ...baseline, interestCount: 8 };
    expect(computeGameSignalHash(bumped)).not.toBe(
      computeGameSignalHash(baseline),
    );
  });

  it('changes when tagsHash changes', () => {
    const bumped: GameSignalSummary = { ...baseline, tagsHash: 'tag-hash-b' };
    expect(computeGameSignalHash(bumped)).not.toBe(
      computeGameSignalHash(baseline),
    );
  });

  it('changes when genresHash changes', () => {
    const bumped: GameSignalSummary = {
      ...baseline,
      genresHash: 'genre-hash-b',
    };
    expect(computeGameSignalHash(bumped)).not.toBe(
      computeGameSignalHash(baseline),
    );
  });

  it('changes when modesHash changes', () => {
    const bumped: GameSignalSummary = { ...baseline, modesHash: 'mode-hash-b' };
    expect(computeGameSignalHash(bumped)).not.toBe(
      computeGameSignalHash(baseline),
    );
  });

  it('changes when themesHash changes', () => {
    const bumped: GameSignalSummary = {
      ...baseline,
      themesHash: 'theme-hash-b',
    };
    expect(computeGameSignalHash(bumped)).not.toBe(
      computeGameSignalHash(baseline),
    );
  });
});
