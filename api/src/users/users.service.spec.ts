import { Test, TestingModule } from '@nestjs/testing';
import {
  UsersService,
  RECENT_MEMBER_DAYS,
  RECENT_MEMBER_LIMIT,
} from './users.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { TokenBlocklistService } from '../auth/token-blocklist.service';

function describeUsersService() {
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
        {
          provide: TokenBlocklistService,
          useValue: { blockUser: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  function describeFindRecent() {
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
  }
  describe('findRecent', () => describeFindRecent());

  describe('checkDisplayNameAvailability (ROK-219)', () => {
    it('should return true when display name is available', async () => {
      mockDb.where.mockResolvedValue([{ count: 0 }]);

      const result =
        await service.checkDisplayNameAvailability('AvailableName');

      expect(result).toBe(true);
    });

    it('should return false when display name is taken', async () => {
      mockDb.where.mockResolvedValue([{ count: 1 }]);

      const result = await service.checkDisplayNameAvailability('TakenName');

      expect(result).toBe(false);
    });

    it('should exclude specified userId from uniqueness check', async () => {
      mockDb.where.mockResolvedValue([{ count: 0 }]);

      const result = await service.checkDisplayNameAvailability('MyName', 5);

      expect(result).toBe(true);
    });

    it('should perform case-insensitive check', async () => {
      mockDb.where.mockResolvedValue([{ count: 1 }]);

      const result = await service.checkDisplayNameAvailability('testname');

      expect(result).toBe(false);
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  function describeSetDisplayName() {
    it('should update user display name', async () => {
      const updatedUser = {
        id: 1,
        username: 'testuser',
        displayName: 'NewDisplayName',
        avatar: null,
        discordId: '123',
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.returning.mockResolvedValue([updatedUser]);

      const result = await service.setDisplayName(1, 'NewDisplayName');

      expect(result).toEqual(updatedUser);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update the updatedAt timestamp', async () => {
      const now = new Date();
      const updatedUser = {
        id: 2,
        username: 'user2',
        displayName: 'UpdatedName',
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: now,
      };

      mockDb.returning.mockResolvedValue([updatedUser]);

      const result = await service.setDisplayName(2, 'UpdatedName');

      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  }
  describe('setDisplayName (ROK-219)', () => describeSetDisplayName());

  function describeCompleteOnboarding() {
    it('should set onboardingCompletedAt timestamp', async () => {
      const now = new Date();
      const completedUser = {
        id: 1,
        username: 'testuser',
        displayName: 'TestUser',
        avatar: null,
        discordId: '123',
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: now,
        createdAt: new Date(),
        updatedAt: now,
      };

      mockDb.returning.mockResolvedValue([completedUser]);

      const result = await service.completeOnboarding(1);

      expect(result.onboardingCompletedAt).toBeInstanceOf(Date);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update both onboardingCompletedAt and updatedAt', async () => {
      const now = new Date();
      const completedUser = {
        id: 2,
        username: 'user2',
        displayName: null,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: now,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: now,
      };

      mockDb.returning.mockResolvedValue([completedUser]);

      const result = await service.completeOnboarding(2);

      expect(result.onboardingCompletedAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });
  }
  describe('completeOnboarding (ROK-219)', () => describeCompleteOnboarding());

  function describeResetOnboarding() {
    it('should set onboardingCompletedAt to null', async () => {
      const resetUser = {
        id: 1,
        username: 'testuser',
        displayName: 'TestUser',
        avatar: null,
        discordId: '123',
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.returning.mockResolvedValue([resetUser]);

      const result = await service.resetOnboarding(1);

      expect(result.onboardingCompletedAt).toBeNull();
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update the updatedAt timestamp', async () => {
      const now = new Date();
      const resetUser = {
        id: 2,
        username: 'user2',
        displayName: null,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: now,
      };

      mockDb.returning.mockResolvedValue([resetUser]);

      const result = await service.resetOnboarding(2);

      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  }
  describe('resetOnboarding (ROK-312)', () => describeResetOnboarding());

  describe('findByIds (ROK-1088)', () => {
    it('short-circuits on empty input without querying', async () => {
      const result = await service.findByIds([]);
      expect(result).toEqual([]);
      expect(mockDb.query.users.findMany).not.toHaveBeenCalled();
    });

    it('returns the rows findMany resolves with', async () => {
      const rows = [
        { id: 1, username: 'Aragorn' },
        { id: 7, username: 'Legolas' },
      ];
      (mockDb.query.users.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await service.findByIds([1, 7]);

      expect(result).toEqual(rows);
      expect(mockDb.query.users.findMany).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array when no users match', async () => {
      (mockDb.query.users.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findByIds([999]);

      expect(result).toEqual([]);
      expect(mockDb.query.users.findMany).toHaveBeenCalledTimes(1);
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
}
describe('UsersService', () => describeUsersService());
