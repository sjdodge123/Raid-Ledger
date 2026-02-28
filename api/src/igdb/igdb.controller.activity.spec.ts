/**
 * Unit tests for IgdbController game activity endpoints (ROK-443).
 * Tests GET /games/:id/activity and GET /games/:id/now-playing.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IgdbController } from './igdb.controller';
import { IgdbService } from './igdb.service';
import {
  GameActivityResponseSchema,
  GameNowPlayingResponseSchema,
} from '@raid-ledger/contract';

describe('IgdbController — Activity Endpoints (ROK-443)', () => {
  const mockTopPlayers = [
    {
      userId: 1,
      username: 'PlayerOne',
      avatar: 'abc123',
      customAvatarUrl: null,
      discordId: '111',
      totalSeconds: 7200,
    },
    {
      userId: 2,
      username: 'PlayerTwo',
      avatar: null,
      customAvatarUrl: '/avatars/2.webp',
      discordId: '222',
      totalSeconds: 3600,
    },
  ];

  const mockNowPlayingPlayers = [
    {
      userId: 3,
      username: 'ActivePlayer',
      avatar: 'def456',
      customAvatarUrl: null,
      discordId: '333',
    },
  ];

  describe('getGameActivity (GET /games/:id/activity)', () => {
    it('should throw BadRequestException for invalid period (via service mock)', async () => {
      // The controller validates the period before delegating to the service.
      // An invalid period throws before any DB or service call.
      const mockService: Partial<IgdbService> = {
        database: {} as never,
        redisClient: {} as never,
        config: {} as never,
        getGameActivity: jest.fn(),
        getGameNowPlaying: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [IgdbController],
        providers: [{ provide: IgdbService, useValue: mockService }],
      }).compile();

      const ctrl = module.get<IgdbController>(IgdbController);

      await expect(ctrl.getGameActivity(42, 'invalid')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delegate to igdbService.getGameActivity when game exists', async () => {
      // Game exists check returns a row, then delegates to service
      const mockDb: Record<string, jest.Mock> = {};
      for (const m of ['select', 'from', 'where']) {
        mockDb[m] = jest.fn().mockReturnThis();
      }
      mockDb.limit = jest.fn().mockResolvedValue([{ id: 42 }]);

      const mockActivityResult = {
        topPlayers: mockTopPlayers,
        totalSeconds: 10800,
        period: 'week' as const,
      };

      const mockService: Partial<IgdbService> = {
        database: mockDb as never,
        redisClient: {} as never,
        config: {} as never,
        getGameActivity: jest.fn().mockResolvedValue(mockActivityResult),
        getGameNowPlaying: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [IgdbController],
        providers: [{ provide: IgdbService, useValue: mockService }],
      }).compile();

      const ctrl = module.get<IgdbController>(IgdbController);

      const result = await ctrl.getGameActivity(42, 'week');

      expect(result).toEqual(mockActivityResult);
      expect(mockService.getGameActivity).toHaveBeenCalledWith(42, 'week');
    });

    it('should throw BadRequestException for invalid period', async () => {
      const mockService: Partial<IgdbService> = {
        database: {} as never,
        redisClient: {} as never,
        config: {} as never,
        getGameActivity: jest.fn(),
        getGameNowPlaying: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [IgdbController],
        providers: [{ provide: IgdbService, useValue: mockService }],
      }).compile();

      const ctrl = module.get<IgdbController>(IgdbController);

      await expect(ctrl.getGameActivity(1, 'yearly')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException with correct message for invalid period', async () => {
      const mockService: Partial<IgdbService> = {
        database: {} as never,
        redisClient: {} as never,
        config: {} as never,
        getGameActivity: jest.fn(),
        getGameNowPlaying: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [IgdbController],
        providers: [{ provide: IgdbService, useValue: mockService }],
      }).compile();

      const ctrl = module.get<IgdbController>(IgdbController);

      await expect(ctrl.getGameActivity(1, 'bad')).rejects.toThrow(
        'Invalid period. Must be week, month, or all.',
      );
    });

    it('should throw NotFoundException when game does not exist', async () => {
      // Game exists check returns empty
      const mockDbNoGame: Record<string, jest.Mock> = {};
      for (const m of ['select', 'from', 'where']) {
        mockDbNoGame[m] = jest.fn().mockReturnThis();
      }
      mockDbNoGame.limit = jest.fn().mockResolvedValue([]);

      const mockService: Partial<IgdbService> = {
        database: mockDbNoGame as never,
        redisClient: {} as never,
        config: {} as never,
        getGameActivity: jest.fn(),
        getGameNowPlaying: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [IgdbController],
        providers: [{ provide: IgdbService, useValue: mockService }],
      }).compile();

      const ctrl = module.get<IgdbController>(IgdbController);

      await expect(ctrl.getGameActivity(999, 'week')).rejects.toThrow(
        NotFoundException,
      );

      await expect(ctrl.getGameActivity(999, 'week')).rejects.toThrow(
        'Game not found',
      );
    });

    it('should default period to week when not provided', async () => {
      const mockDbNoGame: Record<string, jest.Mock> = {};
      for (const m of ['select', 'from', 'where']) {
        mockDbNoGame[m] = jest.fn().mockReturnThis();
      }
      // Return empty for game exists (so we get NotFoundException, which validates that the code ran)
      mockDbNoGame.limit = jest.fn().mockResolvedValue([]);

      const mockService: Partial<IgdbService> = {
        database: mockDbNoGame as never,
        redisClient: {} as never,
        config: {} as never,
        getGameActivity: jest.fn(),
        getGameNowPlaying: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [IgdbController],
        providers: [{ provide: IgdbService, useValue: mockService }],
      }).compile();

      const ctrl = module.get<IgdbController>(IgdbController);

      // Should not throw BadRequestException (period defaults to 'week')
      // Will throw NotFoundException since the game doesn't exist in mock
      await expect(ctrl.getGameActivity(1, undefined)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('GameActivityResponseSchema validates expected response shape', () => {
      const mockResponse = {
        topPlayers: mockTopPlayers,
        totalSeconds: 10800,
        period: 'week' as const,
      };

      const parseResult = GameActivityResponseSchema.safeParse(mockResponse);
      expect(parseResult.success).toBe(true);
    });

    it('GameActivityResponseSchema rejects invalid period', () => {
      const badResponse = {
        topPlayers: [],
        totalSeconds: 0,
        period: 'yearly',
      };

      const parseResult = GameActivityResponseSchema.safeParse(badResponse);
      expect(parseResult.success).toBe(false);
    });

    it('GameActivityResponseSchema accepts empty topPlayers', () => {
      const emptyResponse = {
        topPlayers: [],
        totalSeconds: 0,
        period: 'all' as const,
      };

      const parseResult = GameActivityResponseSchema.safeParse(emptyResponse);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('getGameNowPlaying (GET /games/:id/now-playing)', () => {
    it('should delegate to igdbService.getGameNowPlaying and return result', async () => {
      const mockNowPlayingResult = {
        players: [],
        count: 0,
      };

      const mockService: Partial<IgdbService> = {
        database: {} as never,
        redisClient: {} as never,
        config: {} as never,
        getGameActivity: jest.fn(),
        getGameNowPlaying: jest.fn().mockResolvedValue(mockNowPlayingResult),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [IgdbController],
        providers: [{ provide: IgdbService, useValue: mockService }],
      }).compile();

      const ctrl = module.get<IgdbController>(IgdbController);

      const result = await ctrl.getGameNowPlaying(1);

      expect(result).toMatchObject({
        players: [],
        count: 0,
      });
      expect(mockService.getGameNowPlaying).toHaveBeenCalledWith(1);
    });

    it('should return players from the service', async () => {
      const mockNowPlayingResult = {
        players: mockNowPlayingPlayers,
        count: 1,
      };

      const mockService: Partial<IgdbService> = {
        database: {} as never,
        redisClient: {} as never,
        config: {} as never,
        getGameActivity: jest.fn(),
        getGameNowPlaying: jest.fn().mockResolvedValue(mockNowPlayingResult),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [IgdbController],
        providers: [{ provide: IgdbService, useValue: mockService }],
      }).compile();

      const ctrl = module.get<IgdbController>(IgdbController);

      const result = await ctrl.getGameNowPlaying(42);

      expect(result.players).toHaveLength(1);
      expect(result.count).toBe(1);
      expect(mockService.getGameNowPlaying).toHaveBeenCalledWith(42);
    });

    it('GameNowPlayingResponseSchema validates correct response shape', () => {
      const mockResponse = {
        players: mockNowPlayingPlayers,
        count: 1,
      };

      const parseResult = GameNowPlayingResponseSchema.safeParse(mockResponse);
      expect(parseResult.success).toBe(true);
    });

    it('GameNowPlayingResponseSchema accepts players with null optional fields', () => {
      const responseWithNulls = {
        players: [
          {
            userId: 1,
            username: 'TestPlayer',
            avatar: null,
            customAvatarUrl: null,
            discordId: null,
          },
        ],
        count: 1,
      };

      const parseResult =
        GameNowPlayingResponseSchema.safeParse(responseWithNulls);
      expect(parseResult.success).toBe(true);
    });

    it('GameNowPlayingResponseSchema rejects missing count field', () => {
      const badResponse = {
        players: [],
        // missing count
      };

      const parseResult = GameNowPlayingResponseSchema.safeParse(badResponse);
      expect(parseResult.success).toBe(false);
    });

    it('GameNowPlayingResponseSchema accepts empty players array', () => {
      const emptyResponse = { players: [], count: 0 };

      const parseResult = GameNowPlayingResponseSchema.safeParse(emptyResponse);
      expect(parseResult.success).toBe(true);
    });
  });
});
