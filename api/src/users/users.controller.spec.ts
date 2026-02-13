import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { PreferencesService } from './preferences.service';
import { GameTimeService } from './game-time.service';
import { CharactersService } from '../characters/characters.service';
import { RecentPlayersResponseSchema } from '@raid-ledger/contract';

describe('UsersController', () => {
  let controller: UsersController;
  let mockUsersService: Partial<UsersService>;

  beforeEach(async () => {
    mockUsersService = {
      findRecent: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      getHeartedGames: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: AvatarService, useValue: {} },
        { provide: PreferencesService, useValue: {} },
        { provide: GameTimeService, useValue: {} },
        { provide: CharactersService, useValue: {} },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
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

      (mockUsersService.findRecent as jest.Mock).mockResolvedValue(mockRows);

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

      (mockUsersService.findRecent as jest.Mock).mockResolvedValue(mockRows);

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

      (mockUsersService.findRecent as jest.Mock).mockResolvedValue(mockRows);

      const result = await controller.listRecentPlayers();

      // Validate against the Zod schema
      const parseResult = RecentPlayersResponseSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return empty data array when no recent users', async () => {
      (mockUsersService.findRecent as jest.Mock).mockResolvedValue([]);

      const result = await controller.listRecentPlayers();

      expect(result.data).toEqual([]);
    });
  });
});
