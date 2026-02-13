import { Test, TestingModule } from '@nestjs/testing';
import {
  UsersService,
  RECENT_MEMBER_DAYS,
  RECENT_MEMBER_LIMIT,
} from './users.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

/**
 * Chain-mock: each method returns `this` so all Drizzle chain calls work.
 * Terminal calls resolve with mockResolvedValue.
 */
function createChainMock() {
  const mock: Record<string, jest.Mock> = {};
  const chainMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'innerJoin',
    'insert',
    'values',
    'returning',
    'update',
    'set',
  ];
  for (const m of chainMethods) {
    mock[m] = jest.fn().mockReturnThis();
  }
  mock.query = { users: { findFirst: jest.fn() } } as unknown as jest.Mock;
  return mock;
}

describe('UsersService', () => {
  let service: UsersService;
  let mockDb: ReturnType<typeof createChainMock>;

  beforeEach(async () => {
    mockDb = createChainMock();

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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findRecent', () => {
    it('should return users created within the recent member window', async () => {
      const recentUser = {
        id: 1,
        username: 'NewPlayer',
        avatar: 'abc123',
        discordId: '123456',
        customAvatarUrl: null,
        createdAt: new Date('2026-02-10T12:00:00Z'),
      };

      mockDb.limit.mockResolvedValue([recentUser]);

      const result = await service.findRecent();

      expect(result).toEqual([recentUser]);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
      expect(mockDb.limit).toHaveBeenCalledWith(RECENT_MEMBER_LIMIT);
    });

    it('should order by newest first (createdAt DESC)', async () => {
      const user1 = {
        id: 1,
        username: 'OlderNewbie',
        avatar: null,
        discordId: '111',
        customAvatarUrl: null,
        createdAt: new Date('2026-02-01T00:00:00Z'),
      };
      const user2 = {
        id: 2,
        username: 'NewestPlayer',
        avatar: null,
        discordId: '222',
        customAvatarUrl: null,
        createdAt: new Date('2026-02-12T00:00:00Z'),
      };

      // DB returns in DESC order (newest first)
      mockDb.limit.mockResolvedValue([user2, user1]);

      const result = await service.findRecent();

      expect(result[0].username).toBe('NewestPlayer');
      expect(result[1].username).toBe('OlderNewbie');
    });

    it('should respect the recent member limit', async () => {
      mockDb.limit.mockResolvedValue([]);

      await service.findRecent();

      expect(mockDb.limit).toHaveBeenCalledWith(RECENT_MEMBER_LIMIT);
    });

    it('should return empty array when no recent users exist', async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await service.findRecent();

      expect(result).toEqual([]);
    });

    it('should include required fields (id, username, avatar, createdAt)', async () => {
      const user = {
        id: 5,
        username: 'TestUser',
        avatar: 'hash123',
        discordId: '999',
        customAvatarUrl: '/avatars/5.webp',
        createdAt: new Date('2026-02-13T00:00:00Z'),
      };

      mockDb.limit.mockResolvedValue([user]);

      const result = await service.findRecent();

      expect(result[0]).toHaveProperty('id', 5);
      expect(result[0]).toHaveProperty('username', 'TestUser');
      expect(result[0]).toHaveProperty('avatar', 'hash123');
      expect(result[0]).toHaveProperty('createdAt');
      expect(result[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe('constants', () => {
    it('should export RECENT_MEMBER_DAYS as 30', () => {
      expect(RECENT_MEMBER_DAYS).toBe(30);
    });

    it('should export RECENT_MEMBER_LIMIT as 10', () => {
      expect(RECENT_MEMBER_LIMIT).toBe(10);
    });
  });
});
