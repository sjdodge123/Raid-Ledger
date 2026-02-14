import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { PreferencesService } from './preferences.service';
import { GameTimeService } from './game-time.service';
import { CharactersService } from '../characters/characters.service';
import { EventsService } from '../events/events.service';
import { RecentPlayersResponseSchema } from '@raid-ledger/contract';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: UsersService;
  let eventsService: EventsService;

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

  const mockEventsResponse = {
    data: [
      {
        id: 1,
        title: 'Test Event',
        description: 'Test description',
        startTime: '2026-02-14T18:00:00Z',
        endTime: '2026-02-14T20:00:00Z',
        creator: {
          id: 1,
          username: 'testuser',
          avatar: null,
          discordId: '123',
          customAvatarUrl: null,
        },
        game: null,
        signupCount: 3,
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
    ],
    total: 1,
  };

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
            unlinkDiscord: jest.fn(),
            setCustomAvatar: jest.fn(),
            findAllWithRoles: jest.fn(),
            setRole: jest.fn(),
            checkDisplayNameAvailability: jest.fn(),
            setDisplayName: jest.fn(),
            completeOnboarding: jest.fn(),
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
          useValue: {
            findAllForUser: jest.fn(),
          },
        },
        {
          provide: EventsService,
          useValue: {
            findUpcomingByUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
    eventsService = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listRecentPlayers', () => {
    it('should return 200 with correct shape', async () => {
      const mockRows = [
        {
          id: 1,
          username: 'NewPlayer1',
          avatar: 'abc123',
          discordId: '111111',
          customAvatarUrl: null,
          createdAt: new Date('2026-02-10T12:00:00Z'),
        },
        {
          id: 2,
          username: 'NewPlayer2',
          avatar: null,
          discordId: '222222',
          customAvatarUrl: '/avatars/2.webp',
          createdAt: new Date('2026-02-08T08:00:00Z'),
        },
      ];

      (usersService.findRecent as jest.Mock).mockResolvedValue(mockRows);

      const result = await controller.listRecentPlayers();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        id: 1,
        username: 'NewPlayer1',
        avatar: 'abc123',
        discordId: '111111',
        customAvatarUrl: null,
        createdAt: '2026-02-10T12:00:00.000Z',
      });
    });

    it('should convert Date createdAt to ISO string', async () => {
      const mockRows = [
        {
          id: 1,
          username: 'Player',
          avatar: null,
          discordId: null,
          customAvatarUrl: null,
          createdAt: new Date('2026-02-13T15:30:00Z'),
        },
      ];

      (usersService.findRecent as jest.Mock).mockResolvedValue(mockRows);

      const result = await controller.listRecentPlayers();

      expect(typeof result.data[0].createdAt).toBe('string');
      expect(result.data[0].createdAt).toBe('2026-02-13T15:30:00.000Z');
    });

    it('should match the RecentPlayersResponseDto schema', async () => {
      const mockRows = [
        {
          id: 1,
          username: 'TestPlayer',
          avatar: 'hash',
          discordId: '12345',
          customAvatarUrl: null,
          createdAt: new Date('2026-02-12T00:00:00Z'),
        },
      ];

      (usersService.findRecent as jest.Mock).mockResolvedValue(mockRows);

      const result = await controller.listRecentPlayers();

      // Validate against the Zod schema
      const parseResult = RecentPlayersResponseSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return empty data array when no recent users', async () => {
      (usersService.findRecent as jest.Mock).mockResolvedValue([]);

      const result = await controller.listRecentPlayers();

      expect(result.data).toEqual([]);
    });
  });

  describe('getUserEventSignups (ROK-299)', () => {
    it('should return upcoming events for valid user', async () => {
      const findByIdSpy = jest
        .spyOn(usersService, 'findById')
        .mockResolvedValue(mockUser as never);
      const findUpcomingSpy = jest
        .spyOn(eventsService, 'findUpcomingByUser')
        .mockResolvedValue(mockEventsResponse);

      const result = await controller.getUserEventSignups(1);

      expect(result).toEqual(mockEventsResponse);
      expect(findByIdSpy).toHaveBeenCalledWith(1);
      expect(findUpcomingSpy).toHaveBeenCalledWith(1);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      jest.spyOn(usersService, 'findById').mockResolvedValue(undefined);
      const findUpcomingSpy = jest.spyOn(eventsService, 'findUpcomingByUser');

      await expect(controller.getUserEventSignups(999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.getUserEventSignups(999)).rejects.toThrow(
        'User not found',
      );
      expect(findUpcomingSpy).not.toHaveBeenCalled();
    });

    it('should return empty data when user has no signups', async () => {
      const emptyResponse = { data: [], total: 0 };
      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      jest
        .spyOn(eventsService, 'findUpcomingByUser')
        .mockResolvedValue(emptyResponse);

      const result = await controller.getUserEventSignups(1);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return limited results when user has many signups', async () => {
      const manyEventsResponse = {
        data: Array.from({ length: 6 }, (_, i) => ({
          id: i + 1,
          title: `Event ${i + 1}`,
          description: 'Test description',
          startTime: `2026-02-${14 + i}T18:00:00Z`,
          endTime: `2026-02-${14 + i}T20:00:00Z`,
          creator: {
            id: 1,
            username: 'testuser',
            avatar: null,
            discordId: '123',
            customAvatarUrl: null,
          },
          game: null,
          signupCount: 1,
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        })),
        total: 10,
      };

      jest.spyOn(usersService, 'findById').mockResolvedValue(mockUser as never);
      jest
        .spyOn(eventsService, 'findUpcomingByUser')
        .mockResolvedValue(manyEventsResponse);

      const result = await controller.getUserEventSignups(1);

      expect(result.data.length).toBe(6);
      expect(result.total).toBe(10);
    });
  });

  describe('checkDisplayName (ROK-219)', () => {
    const mockRequest = { user: { id: 1, role: 'member' } };

    it('should return available:true when display name is available', async () => {
      jest
        .spyOn(usersService, 'checkDisplayNameAvailability')
        .mockResolvedValue(true);

      const result = await controller.checkDisplayName(
        mockRequest as never,
        'AvailableName',
      );

      expect(result.available).toBe(true);
      expect(usersService.checkDisplayNameAvailability).toHaveBeenCalledWith(
        'AvailableName',
        1,
      );
    });

    it('should return available:false when display name is taken', async () => {
      jest
        .spyOn(usersService, 'checkDisplayNameAvailability')
        .mockResolvedValue(false);

      const result = await controller.checkDisplayName(
        mockRequest as never,
        'TakenName',
      );

      expect(result.available).toBe(false);
    });

    it('should throw BadRequestException when name parameter is missing', async () => {
      await expect(
        controller.checkDisplayName(mockRequest as never, undefined),
      ).rejects.toThrow('name query parameter is required');
    });

    it('should validate display name with Zod (min 2 chars)', async () => {
      await expect(
        controller.checkDisplayName(mockRequest as never, 'a'),
      ).rejects.toThrow();
    });

    it('should validate display name with Zod (max 30 chars)', async () => {
      const longName = 'a'.repeat(31);
      await expect(
        controller.checkDisplayName(mockRequest as never, longName),
      ).rejects.toThrow();
    });

    it('should exclude current user from uniqueness check', async () => {
      const checkSpy = jest
        .spyOn(usersService, 'checkDisplayNameAvailability')
        .mockResolvedValue(true);

      await controller.checkDisplayName(mockRequest as never, 'TestName');

      expect(checkSpy).toHaveBeenCalledWith('TestName', 1);
    });
  });

  describe('updateMyProfile (ROK-219)', () => {
    const mockRequest = { user: { id: 1, role: 'member' } };

    it('should update user display name when available', async () => {
      const updatedUser = {
        id: 1,
        username: 'testuser',
        displayName: 'NewName',
        avatar: null,
        discordId: '123',
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(usersService, 'checkDisplayNameAvailability')
        .mockResolvedValue(true);
      jest
        .spyOn(usersService, 'setDisplayName')
        .mockResolvedValue(updatedUser as never);

      const result = await controller.updateMyProfile(mockRequest as never, {
        displayName: 'NewName',
      });

      expect(result.data.displayName).toBe('NewName');
      expect(usersService.setDisplayName).toHaveBeenCalledWith(1, 'NewName');
    });

    it('should throw BadRequestException when display name is taken', async () => {
      jest
        .spyOn(usersService, 'checkDisplayNameAvailability')
        .mockResolvedValue(false);

      await expect(
        controller.updateMyProfile(mockRequest as never, {
          displayName: 'TakenName',
        }),
      ).rejects.toThrow('Display name is already taken');
    });

    it('should validate input with Zod schema', async () => {
      await expect(
        controller.updateMyProfile(mockRequest as never, {
          displayName: 'x',
        }),
      ).rejects.toThrow();
    });

    it('should return updated user data', async () => {
      const updatedUser = {
        id: 1,
        username: 'testuser',
        displayName: 'ValidName',
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(usersService, 'checkDisplayNameAvailability')
        .mockResolvedValue(true);
      jest
        .spyOn(usersService, 'setDisplayName')
        .mockResolvedValue(updatedUser as never);

      const result = await controller.updateMyProfile(mockRequest as never, {
        displayName: 'ValidName',
      });

      expect(result.data).toHaveProperty('id', 1);
      expect(result.data).toHaveProperty('username', 'testuser');
      expect(result.data).toHaveProperty('displayName', 'ValidName');
    });
  });

  describe('completeOnboarding (ROK-219)', () => {
    const mockRequest = { user: { id: 1, role: 'member' } };

    it('should mark onboarding as completed', async () => {
      const completedUser = {
        id: 1,
        username: 'testuser',
        displayName: 'TestUser',
        avatar: null,
        discordId: '123',
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: new Date('2026-02-13T12:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(usersService, 'completeOnboarding')
        .mockResolvedValue(completedUser as never);

      const result = await controller.completeOnboarding(mockRequest as never);

      expect(result.success).toBe(true);
      expect(result.onboardingCompletedAt).toBe('2026-02-13T12:00:00.000Z');
      expect(usersService.completeOnboarding).toHaveBeenCalledWith(1);
    });

    it('should return success and timestamp', async () => {
      const completedUser = {
        id: 2,
        username: 'user2',
        displayName: null,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: new Date('2026-02-13T15:30:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(usersService, 'completeOnboarding')
        .mockResolvedValue(completedUser as never);

      const result = await controller.completeOnboarding(mockRequest as never);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('onboardingCompletedAt');
      expect(typeof result.onboardingCompletedAt).toBe('string');
    });
  });
});
