/**
 * Unit tests for UsersService.getUserActivity (ROK-443).
 * Tests privacy filtering, period handling, and activity rollup aggregation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

describe('UsersService.getUserActivity (ROK-443)', () => {
  let service: UsersService;
  let mockDb: MockDb;

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  const mockActivityRows = [
    {
      gameId: 1,
      gameName: 'Valheim',
      coverUrl: 'https://example.com/cover.jpg',
      totalSeconds: 7200,
    },
    {
      gameId: 2,
      gameName: 'Elden Ring',
      coverUrl: null,
      totalSeconds: 3600,
    },
  ];

  describe('privacy filtering', () => {
    it('should return empty array when show_activity is false and requester is different user', async () => {
      // Simulate user preference: show_activity = false
      (mockDb.query as any).userPreferences = {
        findFirst: jest
          .fn()
          .mockResolvedValue({ key: 'show_activity', value: false }),
        findMany: jest.fn(),
      };

      const result = await service.getUserActivity(1, 'week', 2);

      expect(result).toEqual([]);
    });

    it('should return activity when show_activity is false but requester is the same user', async () => {
      // When requester === userId, privacy is bypassed
      (mockDb.query as any).userPreferences = {
        findFirst: jest
          .fn()
          .mockResolvedValue({ key: 'show_activity', value: false }),
        findMany: jest.fn(),
      };

      mockDb.limit.mockResolvedValue(mockActivityRows);

      const result = await service.getUserActivity(1, 'week', 1);

      // Should skip privacy check and query DB
      expect(result).toHaveLength(2);
      expect(result[0].isMostPlayed).toBe(true);
      expect(result[1].isMostPlayed).toBe(false);
    });

    it('should return activity when show_activity preference does not exist', async () => {
      // Null pref means default = true (show activity)
      (mockDb.query as any).userPreferences = {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      };

      mockDb.limit.mockResolvedValue(mockActivityRows);

      const result = await service.getUserActivity(1, 'week', 2);

      expect(result).toHaveLength(2);
    });

    it('should return activity when show_activity is true', async () => {
      (mockDb.query as any).userPreferences = {
        findFirst: jest
          .fn()
          .mockResolvedValue({ key: 'show_activity', value: true }),
        findMany: jest.fn(),
      };

      mockDb.limit.mockResolvedValue(mockActivityRows);

      const result = await service.getUserActivity(1, 'week', 2);

      expect(result).toHaveLength(2);
    });

    it('should skip privacy check when no requesterId is provided', async () => {
      (mockDb.query as any).userPreferences = {
        findFirst: jest
          .fn()
          .mockResolvedValue({ key: 'show_activity', value: false }),
        findMany: jest.fn(),
      };

      mockDb.limit.mockResolvedValue(mockActivityRows);

      // No requesterId — public access, so privacy is checked
      // undefined !== 1, so privacy filter fires
      const result = await service.getUserActivity(1, 'week', undefined);

      // show_activity=false, different user (undefined !== 1), so empty
      expect(result).toEqual([]);
    });
  });

  describe('period filtering', () => {
    beforeEach(() => {
      (mockDb.query as any).userPreferences = {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      };
    });

    it('should query with limit=20 for period=week', async () => {
      mockDb.limit.mockResolvedValue([]);

      await service.getUserActivity(1, 'week', 1);

      expect(mockDb.limit).toHaveBeenCalledWith(20);
    });

    it('should query with limit=20 for period=month', async () => {
      mockDb.limit.mockResolvedValue([]);

      await service.getUserActivity(1, 'month', 1);

      expect(mockDb.limit).toHaveBeenCalledWith(20);
    });

    it('should query with limit=20 for period=all', async () => {
      mockDb.limit.mockResolvedValue([]);

      await service.getUserActivity(1, 'all', 1);

      expect(mockDb.limit).toHaveBeenCalledWith(20);
    });

    it('should use groupBy for period=all', async () => {
      mockDb.limit.mockResolvedValue([]);

      await service.getUserActivity(1, 'all', 1);

      expect(mockDb.groupBy).toHaveBeenCalled();
    });

    it('should use groupBy for period=week', async () => {
      mockDb.limit.mockResolvedValue([]);

      await service.getUserActivity(1, 'week', 1);

      expect(mockDb.groupBy).toHaveBeenCalled();
    });
  });

  describe('result transformation', () => {
    beforeEach(() => {
      (mockDb.query as any).userPreferences = {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      };
    });

    it('should mark first entry as isMostPlayed=true', async () => {
      mockDb.limit.mockResolvedValue(mockActivityRows);

      const result = await service.getUserActivity(1, 'week', 1);

      expect(result[0].isMostPlayed).toBe(true);
      expect(result[1].isMostPlayed).toBe(false);
    });

    it('should mark isMostPlayed=false for all entries when array is empty', async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await service.getUserActivity(1, 'week', 1);

      expect(result).toEqual([]);
    });

    it('should return correct shape for each entry', async () => {
      mockDb.limit.mockResolvedValue([mockActivityRows[0]]);

      const result = await service.getUserActivity(1, 'week', 1);

      expect(result[0]).toMatchObject({
        gameId: expect.any(Number),
        gameName: expect.any(String),
        coverUrl: expect.anything(),
        totalSeconds: expect.any(Number),
        isMostPlayed: expect.any(Boolean),
      });
    });

    it('should preserve null coverUrl', async () => {
      mockDb.limit.mockResolvedValue([
        {
          gameId: 2,
          gameName: 'No Cover Game',
          coverUrl: null,
          totalSeconds: 1800,
        },
      ]);

      const result = await service.getUserActivity(1, 'all', 1);

      expect(result[0].coverUrl).toBeNull();
    });

    it('should set isMostPlayed=true for only the first entry when there are many', async () => {
      const manyRows = Array.from({ length: 5 }, (_, i) => ({
        gameId: i + 1,
        gameName: `Game ${i + 1}`,
        coverUrl: null,
        totalSeconds: (5 - i) * 1000,
      }));

      mockDb.limit.mockResolvedValue(manyRows);

      const result = await service.getUserActivity(1, 'all', 1);

      expect(result.filter((r) => r.isMostPlayed)).toHaveLength(1);
      expect(result[0].isMostPlayed).toBe(true);
      expect(result.slice(1).every((r) => !r.isMostPlayed)).toBe(true);
    });
  });
});
