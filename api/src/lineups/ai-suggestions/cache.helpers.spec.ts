/**
 * Unit tests for the new SWR cache helpers (ROK-1316).
 *
 * TDD gate: `findLatestForLineup` (any hash, newest-first) and the
 * prune helper (keep newest N rows per lineup) do not exist yet — these
 * tests fail-by-construction until cache.helpers exports them.
 *
 * Style reference: drizzle-mock chain pattern (see drizzle-mock.ts header).
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import * as cacheHelpers from './cache.helpers';

type CacheHelpersWithSwr = typeof cacheHelpers & {
  findLatestForLineup: (
    db: unknown,
    lineupId: number,
  ) => Promise<unknown | null>;
  pruneOldSuggestions: (
    db: unknown,
    lineupId: number,
    keep: number,
  ) => Promise<void>;
};

describe('cache.helpers SWR additions (ROK-1316)', () => {
  describe('findLatestForLineup', () => {
    it('is exported by cache.helpers', () => {
      expect(
        typeof (cacheHelpers as CacheHelpersWithSwr).findLatestForLineup,
      ).toBe('function');
    });

    it('returns the most-recent row for the lineup regardless of voter hash', async () => {
      const mockDb = createDrizzleMock();
      const newest = {
        id: 2,
        lineupId: 7,
        voterSetHash: 'whatever',
        generatedAt: new Date(),
      };
      // Terminal of the select chain returns the newest-first row.
      mockDb.limit.mockResolvedValueOnce([newest]);

      const fn = (cacheHelpers as CacheHelpersWithSwr).findLatestForLineup;
      const row = await fn(mockDb, 7);

      expect(row).toEqual(newest);
      // Ordered by generated_at DESC (newest first) and limited to 1.
      expect(mockDb.orderBy).toHaveBeenCalled();
      expect(mockDb.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when no rows exist for the lineup', async () => {
      const mockDb = createDrizzleMock();
      mockDb.limit.mockResolvedValueOnce([]);
      const fn = (cacheHelpers as CacheHelpersWithSwr).findLatestForLineup;
      await expect(fn(mockDb, 99)).resolves.toBeNull();
    });
  });

  describe('pruneOldSuggestions', () => {
    it('is exported by cache.helpers', () => {
      expect(
        typeof (cacheHelpers as CacheHelpersWithSwr).pruneOldSuggestions,
      ).toBe('function');
    });

    it('issues a delete to prune rows beyond the keep window', async () => {
      const mockDb = createDrizzleMock();
      const fn = (cacheHelpers as CacheHelpersWithSwr).pruneOldSuggestions;
      await fn(mockDb, 7, 2);
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
