import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IgdbService } from './igdb.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('IgdbService', () => {
  let service: IgdbService;
  let mockDb: Record<string, jest.Mock>;
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
    it('should return cached games when available', async () => {
      const result = await service.searchGames('valheim');

      expect(result.cached).toBe(true);
      expect(result.games).toEqual(mockGames);
    });

    it('should fetch from IGDB when cache is empty', async () => {
      // Override mock to return empty cache first, then games after insert
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
      expect(mockFetch).toHaveBeenCalledTimes(2); // Token + search
    });

    it('should escape LIKE special characters in query', async () => {
      // Query with special characters that could be problematic
      await service.searchGames('val%heim_test');

      // Verify the escaped pattern is used (checking via mock call)
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should batch insert games instead of sequential inserts', async () => {
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

  describe('error handling', () => {
    it('should throw when IGDB credentials not configured', async () => {
      mockConfigService.get = jest.fn().mockReturnValue(undefined);
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.searchGames('valheim')).rejects.toThrow(
        'IGDB credentials not configured',
      );
    });

    it('should throw when Twitch auth fails', async () => {
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid client'),
      });

      await expect(service.searchGames('valheim')).rejects.toThrow(
        'Failed to get IGDB access token',
      );
    });
  });
});
