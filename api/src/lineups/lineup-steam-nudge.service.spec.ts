/**
 * TDD tests for LineupSteamNudgeService (ROK-993).
 * Validates Discord DM nudge dispatch, dedup, and SQL-level filtering.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';

function makeRecipient(id: number, displayName = 'TestUser') {
  return { id, displayName };
}

describe('LineupSteamNudgeService', () => {
  let service: LineupSteamNudgeService;
  let mockDb: { execute: jest.Mock };
  let mockNotificationService: { create: jest.Mock };
  let mockDedupService: { checkAndMarkSent: jest.Mock };

  beforeEach(async () => {
    mockDb = { execute: jest.fn().mockResolvedValue([]) };
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
        { provide: NotificationDedupService, useValue: mockDedupService },
      ],
    }).compile();

    service = module.get<LineupSteamNudgeService>(LineupSteamNudgeService);
  });

  describe('nudgeUnlinkedMembers', () => {
    it('dispatches notification for each eligible recipient', async () => {
      mockDb.execute.mockResolvedValueOnce([
        makeRecipient(10),
        makeRecipient(11),
      ]);

      await service.nudgeUnlinkedMembers(42);

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 10 }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 11 }),
      );
    });

    it('does nothing when no eligible recipients', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.nudgeUnlinkedMembers(42);

      expect(mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('uses permanent dedup key per lineup+user to prevent duplicates', async () => {
      mockDb.execute.mockResolvedValueOnce([makeRecipient(10)]);

      await service.nudgeUnlinkedMembers(42);

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'lineup-steam-nudge:42:10',
        null,
      );
    });

    it('skips notification when dedup indicates already sent', async () => {
      mockDb.execute.mockResolvedValueOnce([makeRecipient(10)]);
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.nudgeUnlinkedMembers(42);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('includes lineupId in notification payload', async () => {
      mockDb.execute.mockResolvedValueOnce([makeRecipient(10)]);

      await service.nudgeUnlinkedMembers(42);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { lineupId: 42 } }),
      );
    });
  });
});
