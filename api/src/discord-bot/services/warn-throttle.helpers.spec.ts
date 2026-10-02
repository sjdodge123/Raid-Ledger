/**
 * Unit tests for the pure warn-throttle prune used by the skip-capped warn in
 * `ad-hoc-suppression.helpers.ts`.
 */
import { pruneExpiredWarnings } from './warn-throttle.helpers';

/**
 * The skip-capped warn throttle is a module-level Map keyed by event id. It
 * used to keep every key forever; the prune must drop only lapsed entries and
 * use the same `>=` boundary the throttle uses to decide a warn is due again.
 */
describe('pruneExpiredWarnings (TDB:225)', () => {
  const TTL_MS = 30 * 60 * 1000;
  const NOW_MS = 1_800_000_000_000;

  it('removes an entry whose TTL has lapsed and keeps its fresh sibling', () => {
    const warnedAt = new Map([
      [7, NOW_MS - TTL_MS - 1],
      [8, NOW_MS - 1],
    ]);

    pruneExpiredWarnings(warnedAt, NOW_MS, TTL_MS);

    expect([...warnedAt.keys()]).toEqual([8]);
  });

  it('keeps an entry still inside its TTL', () => {
    const warnedAt = new Map([[7, NOW_MS - TTL_MS + 1]]);

    pruneExpiredWarnings(warnedAt, NOW_MS, TTL_MS);

    expect([...warnedAt.keys()]).toEqual([7]);
  });

  it('removes an entry exactly at the TTL', () => {
    const warnedAt = new Map([[7, NOW_MS - TTL_MS]]);

    pruneExpiredWarnings(warnedAt, NOW_MS, TTL_MS);

    expect([...warnedAt.keys()]).toEqual([]);
  });
});
