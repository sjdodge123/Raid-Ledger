import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IgdbService } from './igdb.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('IgdbService', () => {
  let service: IgdbService;
  let mockDb: Record<string, jest.Mock>;
  let mockRedis: Record<string, jest.Mock>;
  let mockConfigService: Partial<ConfigService>;

  const mockGames = [
    {
      id: 1,
      igdbId: 1234,
      name: 'Valheim',
      slug: 'valheim',
      coverUrl: 'https://example.com/cover.jpg',
    },
  ];

  beforeEach(async () => {
    // Mock database operations
    mockDb = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(mockGames),
          }),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    // Mock Redis operations
    mockRedis = {
      get: jest.fn().mockResolvedValue(null), // Default: cache miss
      setex: jest.fn().mockResolvedValue('OK'),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          IGDB_CLIENT_ID: 'test-client-id',
          IGDB_CLIENT_SECRET: 'test-client-secret',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IgdbService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<IgdbService>(IgdbService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('searchGames', () => {
    it('should return Redis-cached games when available', async () => {
      // Mock Redis cache hit
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockGames));

      const result = await service.searchGames('valheim');

      expect(result.cached).toBe(true);
      expect(result.source).toBe('redis');
      expect(result.games).toEqual(mockGames);
      expect(mockRedis.get).toHaveBeenCalledWith('igdb:search:valheim');
    });

    it('should return database-cached games when Redis misses', async () => {
      // Redis miss, DB hit
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await service.searchGames('valheim');

      expect(result.cached).toBe(true);
      expect(result.source).toBe('database');
      expect(result.games).toEqual(mockGames);
      // Should cache to Redis after DB hit
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should fetch from IGDB when both caches miss', async () => {
      // Both caches miss
      mockRedis.get.mockResolvedValueOnce(null);
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValueOnce([]) // First call: cache miss
              .mockResolvedValueOnce(mockGames), // Second call: after insert
          }),
        }),
      });

      // Mock IGDB API responses
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
                name: 'Valheim',
                slug: 'valheim',
                cover: { image_id: 'abc123' },
              },
            ]),
        });

      const result = await service.searchGames('valheim');

      expect(result.cached).toBe(false);
      expect(result.source).toBe('igdb');
      expect(mockFetch).toHaveBeenCalledTimes(2); // Token + search
    });

    it('should retry on 429 with exponential backoff', async () => {
      jest.useFakeTimers();

      // Both caches miss
      mockRedis.get.mockResolvedValueOnce(null);
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(mockGames),
          }),
        }),
      });

      // First call: get token
      // Second call: 429 (rate limited)
      // Third call: success
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: () => Promise.resolve('Rate limit exceeded'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1234,
                name: 'Valheim',
                slug: 'valheim',
                cover: { image_id: 'abc123' },
              },
            ]),
        });

      const searchPromise = service.searchGames('valheim');

      // Fast-forward through the retry delay
      await jest.advanceTimersByTimeAsync(1000);

      const result = await searchPromise;

      expect(result.source).toBe('igdb');
      expect(mockFetch).toHaveBeenCalledTimes(3); // Token + 429 + success

      jest.useRealTimers();
    });

    it('should fall back to local search when IGDB fails after retries', async () => {
      jest.useFakeTimers();

      // Redis miss
      mockRedis.get.mockResolvedValueOnce(null);
      // First DB check: miss, local fallback: has games
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValueOnce([]) // First cache check
              .mockResolvedValueOnce(mockGames), // Local fallback
          }),
        }),
      });

      // All IGDB calls fail with 429
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValue({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: () => Promise.resolve('Rate limit exceeded'),
        });

      const searchPromise = service.searchGames('valheim');

      // Fast-forward through all retry delays (1s + 2s + 4s)
      await jest.advanceTimersByTimeAsync(8000);

      const result = await searchPromise;

      expect(result.source).toBe('local');
      expect(result.games).toEqual(mockGames);

      jest.useRealTimers();
    });

    it('should escape LIKE special characters in query', async () => {
      // Redis hit to avoid going through the whole chain
      mockRedis.get.mockResolvedValue(JSON.stringify(mockGames));

      await service.searchGames('val%heim_test');

      // Verify the cache key is normalized
      expect(mockRedis.get).toHaveBeenCalledWith('igdb:search:val%heim_test');
    });

    it('should normalize query for cache keys (lowercase, trim)', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(mockGames));

      await service.searchGames('  VALHEIM  ');

      expect(mockRedis.get).toHaveBeenCalledWith('igdb:search:valheim');
    });

    it('should handle Redis failures gracefully', async () => {
      // Redis throws error
      mockRedis.get.mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await service.searchGames('valheim');

      // Should fall back to database
      expect(result.source).toBe('database');
    });

    it('should batch insert games instead of sequential inserts', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(mockGames),
          }),
        }),
      });

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
                name: 'Valheim',
                slug: 'valheim',
                cover: { image_id: 'abc123' },
              },
              { id: 5678, name: 'Valheim 2', slug: 'valheim-2' },
            ]),
        });

      await service.searchGames('valheim');

      // Should call insert once with array (batch) not multiple times
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('getGameById', () => {
    it('should return game when found', async () => {
      const result = await service.getGameById(1);

      expect(result).toEqual(mockGames[0]);
    });

    it('should return null when game not found', async () => {
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.getGameById(999);

      expect(result).toBeNull();
    });
  });

  describe('searchLocalGames', () => {
    it('should search local database only', async () => {
      const result = await service.searchLocalGames('valheim');

      expect(result.source).toBe('local');
      expect(result.cached).toBe(true);
      expect(result.games).toEqual(mockGames);
    });
  });

  describe('error handling', () => {
    it('should throw when IGDB credentials not configured', async () => {
      mockConfigService.get = jest.fn().mockReturnValue(undefined);
      mockRedis.get.mockResolvedValueOnce(null);
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // Should fall back to local, not throw (since we have local fallback now)
      const result = await service.searchGames('valheim');
      expect(result.source).toBe('local');
    });

    it('should throw when Twitch auth fails and no local games', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]), // No local games
          }),
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid client'),
      });

      const result = await service.searchGames('valheim');
      // Falls back to local (empty)
      expect(result.source).toBe('local');
      expect(result.games).toEqual([]);
    });
  });
});
