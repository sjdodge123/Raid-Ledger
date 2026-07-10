/**
 * Unit coverage for the integer-ID guard at the computeUniqueConflicts
 * entry point. The db argument is `{} as never` throughout: the guard and
 * the empty-dupIds early return must both fire before any query is built,
 * so a non-db object proves no SQL is ever constructed from bad input.
 */
import {
  computeUniqueConflicts,
  type UniqueConflictCounts,
} from './games-dedup-unique-conflicts.helpers';

describe('computeUniqueConflicts integer-ID guard', () => {
  it('rejects when any dupId is not an integer', async () => {
    await expect(
      computeUniqueConflicts({} as never, { canonicalId: 1, dupIds: [2, 3.5] }),
    ).rejects.toThrow(/integers/);
  });

  it('rejects when canonicalId is not an integer', async () => {
    await expect(
      computeUniqueConflicts({} as never, { canonicalId: 1.5, dupIds: [2] }),
    ).rejects.toThrow(/integers/);
    await expect(
      computeUniqueConflicts({} as never, { canonicalId: NaN, dupIds: [2] }),
    ).rejects.toThrow(/integers/);
  });

  it('resolves the all-zero shape for empty dupIds without touching the db', async () => {
    const expected: UniqueConflictCounts = {
      characters: 0,
      lineupEntries: 0,
      lineupMatches: 0,
      lineupVotes: 0,
      eventTypes: 0,
      activityRollups: 0,
      interests: 0,
      interestSuppressions: 0,
      tasteVectors: 0,
    };
    await expect(
      computeUniqueConflicts({} as never, { canonicalId: 1, dupIds: [] }),
    ).resolves.toEqual(expected);
  });
});
