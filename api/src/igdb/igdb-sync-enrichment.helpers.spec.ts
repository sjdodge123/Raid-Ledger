/**
 * Failing tests for enrichSyncedGamesWithItad() (ROK-926).
 *
 * This function does NOT exist yet — these tests are written in TDD mode
 * to define the expected contract before implementation begins.
 *
 * Expected function signature:
 *   enrichSyncedGamesWithItad(db, lookupBySteamAppId) => Promise<number>
 */
import { enrichSyncedGamesWithItad } from './igdb-sync.helpers';
import type { ItadGame } from '../itad/itad.constants';

/**
 * Minimal mock DB supporting the query pattern used by enrichSyncedGamesWithItad:
 *   db.select(...).from(...).where(...) → rows[]
 *   db.update(...).set(...).where(...)
 *
 * Uses manual chaining mocks to avoid coupling to flat-mock terminal methods,
 * since the query terminates at .where() (not .limit() or .returning()).
 */
function createEnrichMockDb(gamesWithSteamId: { id: number; steamAppId: number }[]) {
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });

  const selectWhere = jest.fn().mockResolvedValue(gamesWithSteamId);
  const selectFrom = jest.fn().mockReturnValue({ where: selectWhere });
  const select = jest.fn().mockReturnValue({ from: selectFrom });

  return { select, update, updateSet, updateWhere };
}

function makeItadGame(overrides: Partial<ItadGame> = {}): ItadGame {
  return {
    id: 'itad-uuid-001',
    slug: 'valheim',
    title: 'Valheim',
    type: 'game',
    mature: false,
    assets: { boxart: 'https://cdn.itad.com/boxart/valheim.jpg' },
    ...overrides,
  };
}

describe('enrichSyncedGamesWithItad', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('AC: queries games with non-null steamAppId and calls lookupBySteamAppId for each', () => {
    it('calls lookupBySteamAppId once per game with a steamAppId', async () => {
      const games = [
        { id: 1, steamAppId: 292030 },
        { id: 2, steamAppId: 578080 },
      ];
      const mockDb = createEnrichMockDb(games);
      const mockLookup = jest.fn().mockResolvedValue(null);

      await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      expect(mockLookup).toHaveBeenCalledTimes(2);
      expect(mockLookup).toHaveBeenCalledWith(292030);
      expect(mockLookup).toHaveBeenCalledWith(578080);
    });

    it('returns 0 and makes no lookups when no games have steamAppId', async () => {
      const mockDb = createEnrichMockDb([]);
      const mockLookup = jest.fn();

      const result = await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      expect(mockLookup).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });
  });

  describe('AC: games with successful ITAD lookups get itadGameId, itadBoxartUrl, itadTags updated', () => {
    it('updates DB with itadGameId, itadBoxartUrl, itadTags when lookup succeeds', async () => {
      const games = [{ id: 10, steamAppId: 292030 }];
      const mockDb = createEnrichMockDb(games);
      const itadGame = makeItadGame({
        id: 'itad-uuid-valheim',
        assets: { boxart: 'https://cdn.itad.com/valheim.jpg' },
      });
      const mockLookup = jest.fn().mockResolvedValue(itadGame);

      const result = await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      expect(result).toBe(1);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(mockDb.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          itadGameId: 'itad-uuid-valheim',
          itadBoxartUrl: 'https://cdn.itad.com/valheim.jpg',
          itadTags: expect.any(Array),
        }),
      );
    });

    it('returns count equal to the number of successfully enriched games', async () => {
      const games = [
        { id: 11, steamAppId: 111 },
        { id: 12, steamAppId: 222 },
        { id: 13, steamAppId: 333 },
      ];
      const mockDb = createEnrichMockDb(games);
      const mockLookup = jest
        .fn()
        .mockResolvedValueOnce(makeItadGame({ id: 'uuid-111' }))
        .mockResolvedValueOnce(makeItadGame({ id: 'uuid-222' }))
        .mockResolvedValueOnce(makeItadGame({ id: 'uuid-333' }));

      const result = await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      expect(result).toBe(3);
      expect(mockDb.update).toHaveBeenCalledTimes(3);
    });
  });

  describe('AC: games where ITAD returns null are skipped (no DB update)', () => {
    it('skips DB update when lookupBySteamAppId returns null', async () => {
      const games = [{ id: 20, steamAppId: 999 }];
      const mockDb = createEnrichMockDb(games);
      const mockLookup = jest.fn().mockResolvedValue(null);

      const result = await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      expect(result).toBe(0);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('only updates games where lookup succeeded in a mixed batch', async () => {
      const games = [
        { id: 21, steamAppId: 100 }, // will succeed
        { id: 22, steamAppId: 200 }, // will return null
        { id: 23, steamAppId: 300 }, // will succeed
      ];
      const mockDb = createEnrichMockDb(games);
      const mockLookup = jest
        .fn()
        .mockResolvedValueOnce(makeItadGame({ id: 'uuid-100' }))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeItadGame({ id: 'uuid-300' }));

      const result = await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      expect(result).toBe(2);
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC: individual lookup failures are caught and logged — batch continues', () => {
    it('continues processing remaining games when one lookup throws', async () => {
      const games = [
        { id: 30, steamAppId: 10 },
        { id: 31, steamAppId: 20 },
        { id: 32, steamAppId: 30 },
      ];
      const mockDb = createEnrichMockDb(games);
      const mockLookup = jest
        .fn()
        .mockResolvedValueOnce(makeItadGame({ id: 'uuid-10' }))
        .mockRejectedValueOnce(new Error('ITAD API timeout'))
        .mockResolvedValueOnce(makeItadGame({ id: 'uuid-30' }));

      const result = await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      // Should not throw — continues past the failure
      expect(result).toBe(2);
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });

    it('does not throw when all lookups fail', async () => {
      const games = [
        { id: 40, steamAppId: 777 },
        { id: 41, steamAppId: 888 },
      ];
      const mockDb = createEnrichMockDb(games);
      const mockLookup = jest
        .fn()
        .mockRejectedValue(new Error('Network error'));

      await expect(
        enrichSyncedGamesWithItad(mockDb as never, mockLookup),
      ).resolves.toBe(0);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles a game with no boxart asset gracefully', async () => {
      const games = [{ id: 50, steamAppId: 456 }];
      const mockDb = createEnrichMockDb(games);
      const itadGame = makeItadGame({ assets: undefined });
      const mockLookup = jest.fn().mockResolvedValue(itadGame);

      const result = await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      expect(result).toBe(1);
      expect(mockDb.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          itadGameId: itadGame.id,
          itadBoxartUrl: null,
        }),
      );
    });

    it('re-enriches all games every run (no skip for already-enriched)', async () => {
      // Games that already have itadGameId are still processed — no early-exit
      const games = [
        { id: 60, steamAppId: 500 },
        { id: 61, steamAppId: 501 },
      ];
      const mockDb = createEnrichMockDb(games);
      const mockLookup = jest
        .fn()
        .mockResolvedValue(makeItadGame({ id: 'uuid-new' }));

      await enrichSyncedGamesWithItad(mockDb as never, mockLookup);

      // Both games looked up and updated regardless of prior enrichment state
      expect(mockLookup).toHaveBeenCalledTimes(2);
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });
  });
});
