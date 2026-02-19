/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
/**
 * ROK-375: Unit tests for IGDB game search enrichment, zero-results cache guard,
 * Redis re-query with filters, and adult filter on local fallback.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { IgdbService } from './igdb.service';
import { IGDB_SYNC_QUEUE } from './igdb-sync.constants';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

/**
 * Creates a thenable mock that also exposes query-builder methods (.limit(), .orderBy(), .where()).
 */
function thenableResult(data: unknown[]) {
  const obj: any = {
    then: (resolve: any, reject?: any) =>
      Promise.resolve(data).then(resolve, reject),
    limit: jest.fn().mockImplementation(() => thenableResult(data)),
    orderBy: jest.fn().mockImplementation(() => thenableResult(data)),
    where: jest.fn().mockImplementation(() => thenableResult(data)),
  };
  return obj;
}

/** A full mock game DB row with all ROK-229 expanded fields */
const fullGameRow = {
  id: 1,
  igdbId: 1234,
  name: 'Halo Infinite',
  slug: 'halo-infinite',
  coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg',
  genres: [5, 31],
  summary: 'Master Chief returns.',
  rating: 82.5,
  aggregatedRating: 85.0,
  popularity: 90.0,
  gameModes: [1, 2, 3],
  themes: [1, 17],
  platforms: [6, 169],
  screenshots: ['https://images.igdb.com/screenshot1.jpg'],
  videos: [{ name: 'Trailer', videoId: 'abc123' }],
  firstReleaseDate: new Date('2021-12-08'),
  playerCount: { min: 1, max: 24 },
  twitchGameId: '506416',
  crossplay: true,
  hidden: false,
  banned: false,
  cachedAt: new Date(),
};

describe('IgdbService — ROK-375: enriched search, cache guard, Redis re-query', () => {
  let service: IgdbService;
  let mockDb: Record<string, jest.Mock>;
  let mockRedis: Record<string, jest.Mock>;
  let mockSettingsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest
            .fn()
            .mockImplementation(() => thenableResult([fullGameRow])),
        })),
      })),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([fullGameRow]),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0),
    };

    mockSettingsService = {
      getIgdbConfig: jest.fn().mockResolvedValue(null),
      isIgdbConfigured: jest.fn().mockResolvedValue(false),
      get: jest.fn().mockResolvedValue(null), // adult filter off by default
    };

    const mockSyncQueue = {
      add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
      name: 'igdb-sync',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IgdbService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-val'),
          },
        },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: getQueueToken(IGDB_SYNC_QUEUE), useValue: mockSyncQueue },
        {
          provide: CronJobService,
          useValue: {
            executeWithTracking: jest.fn(
              (_name: string, fn: () => Promise<void>) => fn(),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<IgdbService>(IgdbService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // SearchResult type: games are GameDetailDto[]
  // ============================================================
  describe('search results return GameDetailDto (not IgdbGameDto)', () => {
    it('database layer returns full GameDetailDto with genres/platforms/ratings', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.searchGames('halo');

      expect(result.source).toBe('database');
      expect(result.games.length).toBe(1);

      const game = result.games[0];
      // Verify full GameDetailDto fields are present (not just the 5 basic IgdbGameDto fields)
      expect(game).toHaveProperty('genres');
      expect(game).toHaveProperty('platforms');
      expect(game).toHaveProperty('rating');
      expect(game).toHaveProperty('aggregatedRating');
      expect(game).toHaveProperty('summary');
      expect(game).toHaveProperty('screenshots');
      expect(game).toHaveProperty('videos');
      expect(game).toHaveProperty('firstReleaseDate');
      expect(game).toHaveProperty('playerCount');
      expect(game).toHaveProperty('twitchGameId');
      expect(game).toHaveProperty('crossplay');

      // Verify actual values from the full game row
      expect(game.genres).toEqual([5, 31]);
      expect(game.platforms).toEqual([6, 169]);
      expect(game.rating).toBe(82.5);
      expect(game.summary).toBe('Master Chief returns.');
    });

    it('Redis layer returns full GameDetailDto via mapDbRowToDetail re-query', async () => {
      // Redis cache hit — contains cached game IDs
      mockRedis.get.mockResolvedValue(
        JSON.stringify([{ id: 1 }]),
      );

      const result = await service.searchGames('halo');

      expect(result.source).toBe('redis');
      expect(result.games.length).toBe(1);

      const game = result.games[0];
      // Should have full detail fields from DB re-query, not just cached basic fields
      expect(game).toHaveProperty('genres');
      expect(game).toHaveProperty('platforms');
      expect(game).toHaveProperty('rating');
      expect(game.genres).toEqual([5, 31]);
    });

    it('local fallback returns full GameDetailDto', async () => {
      const result = await service.searchLocalGames('halo');

      expect(result.source).toBe('local');
      expect(result.games.length).toBe(1);

      const game = result.games[0];
      expect(game).toHaveProperty('genres');
      expect(game).toHaveProperty('platforms');
      expect(game).toHaveProperty('rating');
      expect(game.genres).toEqual([5, 31]);
    });

    it('IGDB layer returns full GameDetailDto after upsert and re-query', async () => {
      mockRedis.get.mockResolvedValue(null);
      let selectCallCount = 0;
      mockDb.select = jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: DB search miss, second: banned-games check,
            // third+: return full game rows after upsert
            const data = selectCallCount <= 2 ? [] : [fullGameRow];
            return thenableResult(data);
          }),
        })),
      }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1234,
                name: 'Halo Infinite',
                slug: 'halo-infinite',
                cover: { image_id: 'co4jni' },
                genres: [{ id: 5 }, { id: 31 }],
                platforms: [{ id: 6 }, { id: 169 }],
                rating: 82.5,
              },
            ]),
        });

      const result = await service.searchGames('halo');

      expect(result.source).toBe('igdb');
      const game = result.games[0];
      expect(game).toHaveProperty('genres');
      expect(game).toHaveProperty('platforms');
      expect(game).toHaveProperty('rating');
    });
  });

  // ============================================================
  // Empty IGDB responses NOT cached in Redis (cache poisoning guard)
  // ============================================================
  describe('empty IGDB responses are not cached', () => {
    it('does NOT cache to Redis when IGDB returns empty results', async () => {
      mockRedis.get.mockResolvedValue(null);
      // All DB queries return empty
      mockDb.select = jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => thenableResult([])),
        })),
      }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]), // Empty IGDB response
        });

      const result = await service.searchGames('nonexistentgame');

      expect(result.source).toBe('igdb');
      expect(result.games).toEqual([]);
      // The critical assertion: setex should NOT have been called
      // because empty results should not be cached
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('caches to Redis when IGDB returns non-empty results', async () => {
      mockRedis.get.mockResolvedValue(null);
      let selectCallCount = 0;
      mockDb.select = jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => {
            selectCallCount++;
            const data = selectCallCount <= 2 ? [] : [fullGameRow];
            return thenableResult(data);
          }),
        })),
      }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1234,
                name: 'Halo Infinite',
                slug: 'halo-infinite',
                cover: { image_id: 'co4jni' },
              },
            ]),
        });

      await service.searchGames('halo');

      // Non-empty results should be cached
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('does NOT cache empty DB results to Redis (database layer)', async () => {
      mockRedis.get.mockResolvedValue(null);
      // DB returns empty
      mockDb.select = jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => thenableResult([])),
        })),
      }));

      // IGDB also returns empty
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });

      await service.searchGames('nothing');

      // setex should not be called since nothing was found
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Redis cache hits re-query DB with ban/hide/adult filters
  // ============================================================
  describe('Redis cache hits re-query DB with filters', () => {
    it('re-queries database on Redis hit to enforce current ban/hide state', async () => {
      // Redis returns cached game IDs
      mockRedis.get.mockResolvedValue(
        JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]),
      );

      // DB re-query returns only non-hidden/non-banned games
      const whereCall = jest.fn().mockImplementation(() =>
        thenableResult([fullGameRow]),
      );
      mockDb.select = jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: whereCall,
        })),
      }));

      const result = await service.searchGames('halo');

      expect(result.source).toBe('redis');
      // DB was queried even though Redis had a hit (re-query with filters)
      expect(mockDb.select).toHaveBeenCalled();
      // Only the non-hidden/non-banned game came back
      expect(result.games.length).toBe(1);
    });

    it('returns empty results from Redis if all cached games are now banned/hidden', async () => {
      // Redis returns cached game IDs
      mockRedis.get.mockResolvedValue(
        JSON.stringify([{ id: 1 }]),
      );

      // DB re-query returns empty (game was banned since caching)
      mockDb.select = jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() =>
            thenableResult([]),
          ),
        })),
      }));

      const result = await service.searchGames('halo');

      // Should fall through when cached IDs are empty after re-query
      // (the code checks cachedIds.length > 0 before the DB query, not after)
      // With [{ id: 1 }] the cachedIds array has length 1, so it does query DB
      // When DB returns empty, the redis layer still returns that empty result
      expect(result.source).toBe('redis');
      expect(result.games).toEqual([]);
    });
  });

  // ============================================================
  // Local fallback applies adult content filter
  // ============================================================
  describe('local fallback applies adult content filter', () => {
    it('includes adult filter in DB query when filter is enabled', async () => {
      // Enable adult filter
      mockSettingsService.get.mockResolvedValue('true');

      // Track the where clause call
      const whereCall = jest.fn().mockImplementation(() =>
        thenableResult([fullGameRow]),
      );
      mockDb.select = jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: whereCall,
        })),
      }));

      await service.searchLocalGames('halo');

      // The where() was called, meaning the filters (including adult) were applied
      expect(whereCall).toHaveBeenCalled();
      // We verify indirectly: isAdultFilterEnabled was checked
      expect(mockSettingsService.get).toHaveBeenCalled();
    });

    it('does not apply adult filter when filter is disabled', async () => {
      // Disable adult filter (default: null)
      mockSettingsService.get.mockResolvedValue(null);

      const whereCall = jest.fn().mockImplementation(() =>
        thenableResult([fullGameRow]),
      );
      mockDb.select = jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: whereCall,
        })),
      }));

      await service.searchLocalGames('halo');

      // where() was still called (for name + hidden + banned filters)
      expect(whereCall).toHaveBeenCalled();
    });
  });

  // ============================================================
  // mapDbRowToDetail returns complete GameDetailDto
  // ============================================================
  describe('mapDbRowToDetail', () => {
    it('maps all expanded fields from DB row to GameDetailDto', () => {
      const detail = service.mapDbRowToDetail(fullGameRow as any);

      expect(detail.id).toBe(1);
      expect(detail.igdbId).toBe(1234);
      expect(detail.name).toBe('Halo Infinite');
      expect(detail.slug).toBe('halo-infinite');
      expect(detail.coverUrl).toBe(
        'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg',
      );
      expect(detail.genres).toEqual([5, 31]);
      expect(detail.summary).toBe('Master Chief returns.');
      expect(detail.rating).toBe(82.5);
      expect(detail.aggregatedRating).toBe(85.0);
      expect(detail.popularity).toBe(90.0);
      expect(detail.gameModes).toEqual([1, 2, 3]);
      expect(detail.themes).toEqual([1, 17]);
      expect(detail.platforms).toEqual([6, 169]);
      expect(detail.screenshots).toEqual([
        'https://images.igdb.com/screenshot1.jpg',
      ]);
      expect(detail.videos).toEqual([{ name: 'Trailer', videoId: 'abc123' }]);
      expect(detail.firstReleaseDate).toBe('2021-12-08T00:00:00.000Z');
      expect(detail.playerCount).toEqual({ min: 1, max: 24 });
      expect(detail.twitchGameId).toBe('506416');
      expect(detail.crossplay).toBe(true);
    });

    it('handles null optional fields gracefully', () => {
      const minimalRow = {
        id: 2,
        igdbId: 5678,
        name: 'Minimal Game',
        slug: 'minimal-game',
        coverUrl: null,
        genres: null,
        summary: null,
        rating: null,
        aggregatedRating: null,
        popularity: null,
        gameModes: null,
        themes: null,
        platforms: null,
        screenshots: null,
        videos: null,
        firstReleaseDate: null,
        playerCount: null,
        twitchGameId: null,
        crossplay: null,
        hidden: false,
        banned: false,
        cachedAt: new Date(),
      };

      const detail = service.mapDbRowToDetail(minimalRow as any);

      expect(detail.id).toBe(2);
      expect(detail.name).toBe('Minimal Game');
      expect(detail.coverUrl).toBeNull();
      expect(detail.genres).toEqual([]);
      expect(detail.summary).toBeNull();
      expect(detail.rating).toBeNull();
      expect(detail.gameModes).toEqual([]);
      expect(detail.themes).toEqual([]);
      expect(detail.platforms).toEqual([]);
      expect(detail.screenshots).toEqual([]);
      expect(detail.videos).toEqual([]);
      expect(detail.firstReleaseDate).toBeNull();
      expect(detail.playerCount).toBeNull();
      expect(detail.twitchGameId).toBeNull();
      expect(detail.crossplay).toBeNull();
    });
  });

  // ============================================================
  // SearchResult.source field
  // ============================================================
  describe('SearchResult source field', () => {
    it('returns source "redis" for Redis cache hits', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify([{ id: 1 }]));

      const result = await service.searchGames('halo');
      expect(result.source).toBe('redis');
    });

    it('returns source "database" for DB cache hits', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.searchGames('halo');
      expect(result.source).toBe('database');
    });

    it('returns source "local" for local fallback', async () => {
      const result = await service.searchLocalGames('halo');
      expect(result.source).toBe('local');
    });
  });
});
