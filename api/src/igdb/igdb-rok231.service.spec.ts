/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * ROK-231: Unit tests for game hide/ban and adult content filter methods on IgdbService.
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

describe('IgdbService — ROK-231: hide/ban and adult content filter', () => {
  let service: IgdbService;
  let mockDb: Record<string, jest.Mock>;
  let mockRedis: Record<string, jest.Mock>;
  let mockSettingsService: Record<string, jest.Mock>;

  const mockGame = {
    id: 42,
    igdbId: 9999,
    name: 'Adult Game',
    slug: 'adult-game',
    coverUrl: null,
    hidden: false,
    themes: [42],
    genres: [],
    gameModes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    summary: null,
    rating: null,
    aggregatedRating: null,
    popularity: null,
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
    cachedAt: new Date(),
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => thenableResult([mockGame])),
        })),
      })),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockGame]),
          }),
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
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
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
  // isAdultFilterEnabled
  // ============================================================
  describe('isAdultFilterEnabled', () => {
    it('returns false when setting is null (not configured)', async () => {
      mockSettingsService.get.mockResolvedValue(null);
      const result = await service.isAdultFilterEnabled();
      expect(result).toBe(false);
    });

    it('returns false when setting is "false"', async () => {
      mockSettingsService.get.mockResolvedValue('false');
      const result = await service.isAdultFilterEnabled();
      expect(result).toBe(false);
    });

    it('returns true when setting is "true"', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      const result = await service.isAdultFilterEnabled();
      expect(result).toBe(true);
    });

    it('returns false for any other string value', async () => {
      mockSettingsService.get.mockResolvedValue('1');
      const result = await service.isAdultFilterEnabled();
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // hideGame
  // ============================================================
  describe('hideGame', () => {
    it('hides an existing visible game', async () => {
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue(
            thenableResult([{ id: 42, name: 'Adult Game' }]),
          ),
        }),
      }));

      const updateWhere = jest.fn().mockResolvedValue(undefined);
      const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
      mockDb.update.mockReturnValue({ set: updateSet });

      const result = await service.hideGame(42);

      expect(result.success).toBe(true);
      expect(result.name).toBe('Adult Game');
      expect(result.message).toContain('Adult Game');
      expect(result.message).toContain('hidden');

      // Verify DB was updated with hidden: true
      expect(mockDb.update).toHaveBeenCalled();
      expect(updateSet).toHaveBeenCalledWith({ hidden: true });
    });

    it('returns failure result when game does not exist', async () => {
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue(thenableResult([])),
        }),
      }));

      const result = await service.hideGame(999);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.name).toBe('');
      // Should not attempt DB update
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // unhideGame
  // ============================================================
  describe('unhideGame', () => {
    it('unhides an existing hidden game', async () => {
      const hiddenGame = { id: 42, name: 'Adult Game' };
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue(thenableResult([hiddenGame])),
        }),
      }));

      const updateWhere = jest.fn().mockResolvedValue(undefined);
      const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
      mockDb.update.mockReturnValue({ set: updateSet });

      const result = await service.unhideGame(42);

      expect(result.success).toBe(true);
      expect(result.name).toBe('Adult Game');
      expect(result.message).toContain('visible');

      // Verify DB was updated with hidden: false
      expect(updateSet).toHaveBeenCalledWith({ hidden: false });
    });

    it('returns failure result when game does not exist', async () => {
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue(thenableResult([])),
        }),
      }));

      const result = await service.unhideGame(999);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.name).toBe('');
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // hideAdultGames
  // ============================================================
  describe('hideAdultGames', () => {
    it('returns count of hidden adult games', async () => {
      const hiddenRows = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const returning = jest.fn().mockResolvedValue(hiddenRows);
      const where = jest.fn().mockReturnValue({ returning });
      const set = jest.fn().mockReturnValue({ where });
      mockDb.update.mockReturnValue({ set });

      const count = await service.hideAdultGames();

      expect(count).toBe(3);
      expect(mockDb.update).toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith({ hidden: true });
      expect(returning).toHaveBeenCalled();
    });

    it('returns 0 when no adult games exist', async () => {
      const returning = jest.fn().mockResolvedValue([]);
      const where = jest.fn().mockReturnValue({ returning });
      const set = jest.fn().mockReturnValue({ where });
      mockDb.update.mockReturnValue({ set });

      const count = await service.hideAdultGames();

      expect(count).toBe(0);
    });
  });

  // ============================================================
  // searchGames — hidden games excluded
  // ============================================================
  describe('searchGames — hidden game exclusion', () => {
    it('excludes hidden games from database search results', async () => {
      // Redis miss
      mockRedis.get.mockResolvedValue(null);

      // Only return non-hidden games (the hidden filter is applied at DB level)
      const visibleGame = {
        id: 1,
        igdbId: 111,
        name: 'Valheim',
        slug: 'valheim',
        coverUrl: null,
        hidden: false,
        themes: [],
        genres: [],
        gameModes: [],
        platforms: [],
        screenshots: [],
        videos: [],
      };

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue(thenableResult([visibleGame])),
        }),
      }));

      const result = await service.searchGames('valheim');

      // The DB query chain should have been called (not Redis)
      expect(result.source).toBe('database');
      expect(result.games.every((g) => g.name === 'Valheim')).toBe(true);
    });

    it('excludes adult games from DB search when filter is enabled', async () => {
      // Adult filter ON
      mockSettingsService.get.mockResolvedValue('true');
      mockRedis.get.mockResolvedValue(null);

      // Return empty to simulate adult game filtered out
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue(thenableResult([])),
        }),
      }));

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

      const result = await service.searchGames('adult-game');

      // The IGDB query body should include the adult theme filter
      const igdbCallBody = mockFetch.mock.calls[1][1]?.body as string;
      expect(igdbCallBody).toContain('themes !=');
    });
  });

  // ============================================================
  // searchLocalGames — hidden games excluded
  // ============================================================
  describe('searchLocalGames — hidden game exclusion', () => {
    it('only returns visible games from local fallback', async () => {
      const visibleGame = {
        id: 1,
        igdbId: 111,
        name: 'Visible Game',
        slug: 'visible-game',
        coverUrl: null,
      };

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue(thenableResult([visibleGame])),
        }),
      }));

      const result = await service.searchLocalGames('visible');

      expect(result.source).toBe('local');
      expect(result.games.length).toBe(1);
      expect(result.games[0].name).toBe('Visible Game');
    });

    it('returns empty array when all local games are hidden', async () => {
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue(thenableResult([])),
        }),
      }));

      const result = await service.searchLocalGames('hidden-game');

      expect(result.source).toBe('local');
      expect(result.games).toEqual([]);
    });
  });
});
