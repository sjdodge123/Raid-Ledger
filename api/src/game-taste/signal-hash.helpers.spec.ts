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
  SIGNAL_HASH_VERSION,
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

  /**
   * ROK-1102 item 5 (§4.1 unit 8) — the pool-version salt must genuinely
   * participate in the digest, otherwise the `fps` backfill short-circuits
   * (spec §1.6) and every stored vector keeps its 24-key `dimensions`.
   *
   * Both digests below are CAPTURED, not recomputed:
   *   PRE_SALT  = sha256 of the parts list with no `v:` prefix at all
   *   VERSION_1 = sha256 of the same parts prefixed with `v:1`
   * A dropped salt collapses onto PRE_SALT; a reverted version number
   * collapses onto VERSION_1. Both are assertion failures, not crashes.
   */
  const PRE_SALT_DIGEST =
    '4e62cd03ae3ae7ed31a7a44ec378a077e9e1dddb8c7713eb466f5c19c62c21ef';
  const VERSION_1_DIGEST =
    '9f8776bb0a678d17b828278c57c2c7dfb709051be15502c9787d932af6043914';

  it('salts the digest with SIGNAL_HASH_VERSION (salt is present)', () => {
    expect(computeGameSignalHash(baseline)).not.toBe(PRE_SALT_DIGEST);
  });

  it('changes when SIGNAL_HASH_VERSION is bumped past 1', () => {
    expect(SIGNAL_HASH_VERSION).toBeGreaterThan(1);
    expect(computeGameSignalHash(baseline)).not.toBe(VERSION_1_DIGEST);
  });
});
