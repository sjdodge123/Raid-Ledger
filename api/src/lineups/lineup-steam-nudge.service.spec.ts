/**
 * TDD tests for LineupSteamNudgeService (ROK-993).
 * Validates Discord DM nudge dispatch, dedup, preference checks,
 * and filtering of users by Steam/Discord link status.
 *
 * These tests are written BEFORE the implementation exists.
 * They MUST fail until the dev agent builds the service.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';

/**
 * Mock user rows returned by findNudgeRecipients-style queries.
 * Shape: { id, discordId, steamId, displayName }
 */
function makeUser(overrides: Partial<{
  id: number;
  discordId: string | null;
  steamId: string | null;
  displayName: string;
}> = {}) {
  return {
    id: overrides.id ?? 1,
    discordId: overrides.discordId ?? '111222333',
    steamId: overrides.steamId ?? null,
    displayName: overrides.displayName ?? 'TestUser',
  };
}

describe('LineupSteamNudgeService', () => {
  let service: LineupSteamNudgeService;
  let mockDb: { execute: jest.Mock; select: jest.Mock };
  let mockNotificationService: { create: jest.Mock };
  let mockDedupService: { checkAndMarkSent: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      execute: jest.fn().mockResolvedValue([]),
      select: jest.fn(),
    };

    mockNotificationService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    mockDedupService = {
      checkAndMarkSent: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LineupSteamNudgeService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
        {
          provide: NotificationDedupService,
          useValue: mockDedupService,
        },
      ],
    }).compile();

    service = module.get<LineupSteamNudgeService>(LineupSteamNudgeService);
  });

  describe('nudgeUnlinkedMembers', () => {
    it('dispatches notification for each user with Discord but no Steam', async () => {
      const users = [
        makeUser({ id: 10, discordId: 'disc-10', steamId: null }),
        makeUser({ id: 11, discordId: 'disc-11', steamId: null }),
      ];
      mockDb.execute.mockResolvedValueOnce(users);

      await service.nudgeUnlinkedMembers(42);

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 10 }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 11 }),
      );
    });

    it('skips users who already have Steam linked', async () => {
      const users = [
        makeUser({ id: 10, discordId: 'disc-10', steamId: '76561198000000001' }),
      ];
      mockDb.execute.mockResolvedValueOnce(users);

      await service.nudgeUnlinkedMembers(42);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('skips users without Discord (cannot DM them)', async () => {
      const users = [
        makeUser({ id: 10, discordId: null, steamId: null }),
      ];
      mockDb.execute.mockResolvedValueOnce(users);

      await service.nudgeUnlinkedMembers(42);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('uses permanent dedup key per lineup+user to prevent duplicates', async () => {
      const users = [
        makeUser({ id: 10, discordId: 'disc-10', steamId: null }),
      ];
      mockDb.execute.mockResolvedValueOnce(users);

      await service.nudgeUnlinkedMembers(42);

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'lineup-steam-nudge:42:10',
        null,
      );
    });

    it('skips notification when dedup indicates already sent', async () => {
      const users = [
        makeUser({ id: 10, discordId: 'disc-10', steamId: null }),
      ];
      mockDb.execute.mockResolvedValueOnce(users);
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.nudgeUnlinkedMembers(42);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });
});
