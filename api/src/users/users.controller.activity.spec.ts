/**
 * Unit tests for UsersController.getUserActivity (ROK-443).
 * Tests request parsing, period validation, 404 handling, and privacy delegation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { PreferencesService } from './preferences.service';
import { GameTimeService } from './game-time.service';
import { CharactersService } from '../characters/characters.service';
import { EventsService } from '../events/events.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import {
  UserActivityResponseSchema,
} from '@raid-ledger/contract';

describe('UsersController.getUserActivity (ROK-443)', () => {
  let controller: UsersController;
  let usersService: UsersService;

  const mockUser = {
    id: 1,
    username: 'testuser',
    avatar: null,
    discordId: '123',
    customAvatarUrl: null,
    role: 'member',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockActivityEntries = [
    {
      gameId: 1,
      gameName: 'Valheim',
      coverUrl: 'https://example.com/cover.jpg',
      totalSeconds: 7200,
      isMostPlayed: true,
    },
    {
      gameId: 2,
      gameName: 'Elden Ring',
      coverUrl: null,
      totalSeconds: 3600,
      isMostPlayed: false,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(),
            findRecent: jest.fn(),
            findAll: jest.fn(),
            getHeartedGames: jest.fn(),
            getUserActivity: jest.fn(),
            unlinkDiscord: jest.fn(),
            setCustomAvatar: jest.fn(),
            findAllWithRoles: jest.fn(),
            setRole: jest.fn(),
            checkDisplayNameAvailability: jest.fn(),
            setDisplayName: jest.fn(),
            completeOnboarding: jest.fn(),
            resetOnboarding: jest.fn(),
            deleteUser: jest.fn(),
            findAdmin: jest.fn(),
          },
        },
        {
          provide: AvatarService,
          useValue: {
            checkRateLimit: jest.fn(),
            validateAndProcess: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: PreferencesService,
          useValue: {
            getUserPreferences: jest.fn(),
            setUserPreference: jest.fn(),
          },
        },
        {
          provide: GameTimeService,
          useValue: {
            getCompositeView: jest.fn(),
            saveTemplate: jest.fn(),
            saveOverrides: jest.fn(),
            createAbsence: jest.fn(),
            deleteAbsence: jest.fn(),
            getAbsences: jest.fn(),
          },
        },
        {
          provide: CharactersService,
          useValue: { findAllForUser: jest.fn() },
        },
        {
          provide: EventsService,
          useValue: { findUpcomingByUser: jest.fn() },
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(false),
            getGuildInfo: jest.fn().mockReturnValue(null),
            getClient: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: ChannelResolverService,
          useValue: { resolveChannelForEvent: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
  });

  describe('period validation', () => {
    it('should default period to week when not provided', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      const activitySpy = jest
        .spyOn(usersService, 'getUserActivity')
        .mockResolvedValue(mockActivityEntries);

      await controller.getUserActivity(1, undefined, undefined);

      expect(activitySpy).toHaveBeenCalledWith(1, 'week', undefined);
    });

    it('should accept period=week', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      const activitySpy = jest
        .spyOn(usersService, 'getUserActivity')
        .mockResolvedValue(mockActivityEntries);

      await controller.getUserActivity(1, 'week', undefined);

      expect(activitySpy).toHaveBeenCalledWith(1, 'week', undefined);
    });

    it('should accept period=month', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      const activitySpy = jest
        .spyOn(usersService, 'getUserActivity')
        .mockResolvedValue([]);

      await controller.getUserActivity(1, 'month', undefined);

      expect(activitySpy).toHaveBeenCalledWith(1, 'month', undefined);
    });

    it('should accept period=all', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      const activitySpy = jest
        .spyOn(usersService, 'getUserActivity')
        .mockResolvedValue([]);

      await controller.getUserActivity(1, 'all', undefined);

      expect(activitySpy).toHaveBeenCalledWith(1, 'all', undefined);
    });

    it('should throw BadRequestException for invalid period', async () => {
      await expect(
        controller.getUserActivity(1, 'invalid', undefined),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getUserActivity(1, 'invalid', undefined),
      ).rejects.toThrow('Invalid period. Must be week, month, or all.');
    });

    it('should throw BadRequestException for period=daily (not in enum)', async () => {
      await expect(
        controller.getUserActivity(1, 'daily', undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('user not found', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(undefined);

      await expect(
        controller.getUserActivity(999, 'week', undefined),
      ).rejects.toThrow(NotFoundException);

      await expect(
        controller.getUserActivity(999, 'week', undefined),
      ).rejects.toThrow('User not found');
    });

    it('should not call getUserActivity when user is not found', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(undefined);
      const activitySpy = jest.spyOn(usersService, 'getUserActivity');

      try {
        await controller.getUserActivity(999, 'week', undefined);
      } catch {
        // expected
      }

      expect(activitySpy).not.toHaveBeenCalled();
    });
  });

  describe('response shape', () => {
    it('should return data and period in response', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      jest.spyOn(usersService, 'getUserActivity').mockResolvedValue(mockActivityEntries);

      const result = await controller.getUserActivity(1, 'week', undefined);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('period', 'week');
      expect(result.data).toEqual(mockActivityEntries);
    });

    it('should validate against UserActivityResponseSchema', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      jest.spyOn(usersService, 'getUserActivity').mockResolvedValue(mockActivityEntries);

      const result = await controller.getUserActivity(1, 'month', undefined);

      const parseResult = UserActivityResponseSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return empty data array when user has no activity', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      jest.spyOn(usersService, 'getUserActivity').mockResolvedValue([]);

      const result = await controller.getUserActivity(1, 'week', undefined);

      expect(result.data).toEqual([]);
      expect(result.period).toBe('week');
    });

    it('should pass requesterId from auth to service for privacy check', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      const activitySpy = jest
        .spyOn(usersService, 'getUserActivity')
        .mockResolvedValue([]);

      const req = { user: { id: 42 } };
      await controller.getUserActivity(1, 'week', req);

      expect(activitySpy).toHaveBeenCalledWith(1, 'week', 42);
    });

    it('should pass undefined requesterId when no auth token', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      const activitySpy = jest
        .spyOn(usersService, 'getUserActivity')
        .mockResolvedValue([]);

      await controller.getUserActivity(1, 'week', undefined);

      expect(activitySpy).toHaveBeenCalledWith(1, 'week', undefined);
    });

    it('should return period=all in response when requested', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      jest.spyOn(usersService, 'getUserActivity').mockResolvedValue([]);

      const result = await controller.getUserActivity(1, 'all', undefined);

      expect(result.period).toBe('all');
    });
  });
});
