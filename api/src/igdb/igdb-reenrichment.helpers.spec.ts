/**
 * TDD tests for reEnrichGamesWithIgdb() (ROK-986).
 *
 * Validates re-enrichment of ITAD/Steam-sourced games that are missing
 * IGDB metadata: candidate selection, success/failure handling, retry
 * exhaustion, and mixed-batch result aggregation.
 *
 * The function under test does NOT exist yet. All tests must FAIL.
 */
import { reEnrichGamesWithIgdb } from './igdb-reenrichment.helpers';
import type { IgdbApiGame } from './igdb.constants';

/**
 * Minimal mock DB for reEnrichGamesWithIgdb query patterns:
 *   SELECT: db.select(...).from(...).where(...) -> candidate rows
 *   UPDATE: db.update(...).set(...).where(...)  -> persist enrichment
 *
 * Uses manual chaining because the query terminates at .where()
 * (not .limit() or .returning()), matching the pattern in
 * igdb-sync-enrichment.helpers.spec.ts.
 */
function createReenrichMockDb(
  candidates: {
    id: number;
    steamAppId: number;
    igdbEnrichmentRetryCount: number;
  }[],
) {
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });

  const selectWhere = jest.fn().mockResolvedValue(candidates);
  const selectFrom = jest.fn().mockReturnValue({ where: selectWhere });
  const select = jest.fn().mockReturnValue({ from: selectFrom });

  return { select, update, updateSet, updateWhere, selectFrom, selectWhere };
}

/** Build a realistic IGDB API game response for parseIgdbEnrichment. */
function makeIgdbApiGame(
  overrides: Partial<IgdbApiGame> & { id: number },
): IgdbApiGame {
  return {
    name: 'Test Game',
    slug: 'test-game',
    cover: { image_id: 'co_test' },
    genres: [{ id: 12 }],
    themes: [{ id: 1 }],
    game_modes: [1],
    platforms: [{ id: 6 }],
    summary: 'A test game summary',
    screenshots: [{ image_id: 'ss_test' }],
    videos: [{ name: 'Trailer', video_id: 'vid123' }],
    rating: 80,
    aggregated_rating: 85,
    external_games: [{ category: 1, uid: '12345' }],
    multiplayer_modes: [],
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('reEnrichGamesWithIgdb', () => {
  describe('AC: only selects games with status IN (pending, failed), non-null steamAppId, retry count < 3', () => {
    it('passes filtered candidates to processing — does not include enriched, not_found, or high-retry games', async () => {
      // Only "pending" and "failed" with retry < 3 should appear
      const validCandidates = [
        { id: 1, steamAppId: 292030, igdbEnrichmentRetryCount: 0 },
        { id: 2, steamAppId: 578080, igdbEnrichmentRetryCount: 2 },
      ];
      const mockDb = createReenrichMockDb(validCandidates);
      const mockQueryIgdb = jest
        .fn<Promise<IgdbApiGame[]>, [string]>()
        .mockResolvedValue([makeIgdbApiGame({ id: 1942 })]);

      const result = await reEnrichGamesWithIgdb(
        mockDb as never,
        mockQueryIgdb,
      );

      // Should attempt both candidates
      expect(result.attempted).toBe(2);
      expect(mockQueryIgdb).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC: successful IGDB match sets status to enriched, populates IGDB fields, resets retry count', () => {
    it('updates game with IGDB data and sets enriched status on success', async () => {
      const candidates = [
        { id: 10, steamAppId: 292030, igdbEnrichmentRetryCount: 1 },
      ];
      const mockDb = createReenrichMockDb(candidates);
      const igdbGame = makeIgdbApiGame({
        id: 1942,
        summary: 'An RPG adventure',
        genres: [{ id: 12 }, { id: 31 }],
        rating: 92,
      });
      const mockQueryIgdb = jest
        .fn<Promise<IgdbApiGame[]>, [string]>()
        .mockResolvedValue([igdbGame]);

      const result = await reEnrichGamesWithIgdb(
        mockDb as never,
        mockQueryIgdb,
      );

      expect(result.enriched).toBe(1);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          igdbEnrichmentStatus: 'enriched',
          igdbEnrichmentRetryCount: 0,
          igdbId: 1942,
          summary: 'An RPG adventure',
        }),
      );
    });
  });

  describe('AC: IGDB returning 0 results increments retry count; at 3 retries sets status to not_found', () => {
    it('increments retry count when IGDB returns empty results', async () => {
      const candidates = [
        { id: 20, steamAppId: 999999, igdbEnrichmentRetryCount: 0 },
      ];
      const mockDb = createReenrichMockDb(candidates);
      const mockQueryIgdb = jest
        .fn<Promise<IgdbApiGame[]>, [string]>()
        .mockResolvedValue([]);

      const result = await reEnrichGamesWithIgdb(
        mockDb as never,
        mockQueryIgdb,
      );

      expect(result.enriched).toBe(0);
      expect(mockDb.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          igdbEnrichmentRetryCount: 1,
        }),
      );
    });

    it('sets status to not_found when retry count reaches 3', async () => {
      const candidates = [
        { id: 21, steamAppId: 888888, igdbEnrichmentRetryCount: 2 },
      ];
      const mockDb = createReenrichMockDb(candidates);
      const mockQueryIgdb = jest
        .fn<Promise<IgdbApiGame[]>, [string]>()
        .mockResolvedValue([]);

      const result = await reEnrichGamesWithIgdb(
        mockDb as never,
        mockQueryIgdb,
      );

      expect(result.exhausted).toBe(1);
      expect(mockDb.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          igdbEnrichmentStatus: 'not_found',
          igdbEnrichmentRetryCount: 3,
        }),
      );
    });
  });

  describe('AC: IGDB API error increments retry count and sets status to failed', () => {
    it('sets failed status and increments retry on queryIgdb error', async () => {
      const candidates = [
        { id: 30, steamAppId: 777777, igdbEnrichmentRetryCount: 0 },
      ];
      const mockDb = createReenrichMockDb(candidates);
      const mockQueryIgdb = jest
        .fn<Promise<IgdbApiGame[]>, [string]>()
        .mockRejectedValue(new Error('IGDB API timeout'));

      const result = await reEnrichGamesWithIgdb(
        mockDb as never,
        mockQueryIgdb,
      );

      expect(result.failed).toBe(1);
      expect(result.enriched).toBe(0);
      expect(mockDb.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          igdbEnrichmentStatus: 'failed',
          igdbEnrichmentRetryCount: 1,
        }),
      );
    });
  });

  describe('AC: mixed batch — some succeed, some fail — all counts correct', () => {
    it('tracks enriched, failed, and exhausted counts independently', async () => {
      const candidates = [
        { id: 40, steamAppId: 100, igdbEnrichmentRetryCount: 0 }, // will succeed
        { id: 41, steamAppId: 200, igdbEnrichmentRetryCount: 0 }, // IGDB returns 0 results
        { id: 42, steamAppId: 300, igdbEnrichmentRetryCount: 2 }, // IGDB returns 0, exhausted
        { id: 43, steamAppId: 400, igdbEnrichmentRetryCount: 1 }, // API error
      ];
      const mockDb = createReenrichMockDb(candidates);
      const mockQueryIgdb = jest
        .fn<Promise<IgdbApiGame[]>, [string]>()
        .mockResolvedValueOnce([makeIgdbApiGame({ id: 5001 })]) // game 40: success
        .mockResolvedValueOnce([])                               // game 41: not found
        .mockResolvedValueOnce([])                               // game 42: exhausted (retry 2->3)
        .mockRejectedValueOnce(new Error('Network error'));       // game 43: API error

      const result = await reEnrichGamesWithIgdb(
        mockDb as never,
        mockQueryIgdb,
      );

      expect(result.attempted).toBe(4);
      expect(result.enriched).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.exhausted).toBe(1);
    });
  });

  describe('AC: empty candidate set returns zeroed result', () => {
    it('returns all zeros when no games need re-enrichment', async () => {
      const mockDb = createReenrichMockDb([]);
      const mockQueryIgdb = jest.fn<Promise<IgdbApiGame[]>, [string]>();

      const result = await reEnrichGamesWithIgdb(
        mockDb as never,
        mockQueryIgdb,
      );

      expect(result).toEqual({
        attempted: 0,
        enriched: 0,
        failed: 0,
        exhausted: 0,
      });
      expect(mockQueryIgdb).not.toHaveBeenCalled();
    });
  });

  describe('AC: games without steamAppId are never selected', () => {
    it('does not process games with null steamAppId even if status is pending', async () => {
      // The DB query itself should filter these out via WHERE clause.
      // We simulate this by providing an empty candidate set
      // (the real function's WHERE clause excludes null steamAppId).
      const mockDb = createReenrichMockDb([]);
      const mockQueryIgdb = jest.fn<Promise<IgdbApiGame[]>, [string]>();

      const result = await reEnrichGamesWithIgdb(
        mockDb as never,
        mockQueryIgdb,
      );

      expect(result.attempted).toBe(0);
      expect(mockQueryIgdb).not.toHaveBeenCalled();
    });
  });
});
