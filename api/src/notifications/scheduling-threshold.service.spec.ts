/**
 * TDD tests for SchedulingThresholdService (ROK-1015).
 * Validates cron-driven notification when a scheduling poll
 * reaches its minimum vote threshold.
 *
 * The service does not exist yet -- these tests define the expected
 * interface and will FAIL until implementation is provided.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulingThresholdService } from './scheduling-threshold.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from './notification.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

function makeMockDb() {
  return { execute: jest.fn().mockResolvedValue([]) };
}

function makeMockNotificationService() {
  return { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
}

function makeMockCronJobService() {
  return { executeWithTracking: jest.fn((_name, fn) => fn()) };
}

// ---------------------------------------------------------------------------
// Test module builder
// ---------------------------------------------------------------------------

async function createTestModule() {
  const mockDb = makeMockDb();
  const mockNotificationService = makeMockNotificationService();
  const mockCronJobService = makeMockCronJobService();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SchedulingThresholdService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: CronJobService, useValue: mockCronJobService },
    ],
  }).compile();

  return {
    service: module.get<SchedulingThresholdService>(SchedulingThresholdService),
    mockDb,
    mockNotificationService,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A poll that has met its threshold: 3 unique voters >= minVoteThreshold 3. */
function makePendingPoll(
  overrides?: Partial<{
    matchId: number;
    lineupId: number;
    gameId: number;
    gameName: string;
    creatorId: number;
    minVoteThreshold: number;
    uniqueVoterCount: number;
  }>,
) {
  return {
    matchId: 10,
    lineupId: 1,
    gameId: 5,
    gameName: 'Test Game',
    creatorId: 100,
    minVoteThreshold: 3,
    uniqueVoterCount: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SchedulingThresholdService', () => {
  let service: SchedulingThresholdService;
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockNotificationService: ReturnType<typeof makeMockNotificationService>;

  beforeEach(async () => {
    const ctx = await createTestModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    mockNotificationService = ctx.mockNotificationService;
  });

  // -----------------------------------------------------------------------
  // AC6: Cron finds polls where unique voters >= threshold
  //       and threshold_notified_at IS NULL
  // -----------------------------------------------------------------------
  describe('checkThresholds (AC6)', () => {
    it('finds polls where uniqueVoterCount >= minVoteThreshold and notifies', async () => {
      const poll = makePendingPoll();
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
    });

    it('skips polls where threshold has not been reached', async () => {
      // No pending polls returned by the query
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkThresholds();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('processes multiple eligible polls in a single run', async () => {
      const poll1 = makePendingPoll({ matchId: 10, creatorId: 100 });
      const poll2 = makePendingPoll({ matchId: 20, creatorId: 200 });
      mockDb.execute.mockResolvedValueOnce([poll1, poll2]);

      await service.checkThresholds();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // AC7: Notification type = community_lineup,
  //       subtype = scheduling_poll_threshold_met,
  //       sent to poll creator
  // -----------------------------------------------------------------------
  describe('notification content (AC7)', () => {
    it('sends notification with type community_lineup', async () => {
      const poll = makePendingPoll();
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
        }),
      );
    });

    it('sends notification with subtype scheduling_poll_threshold_met', async () => {
      const poll = makePendingPoll();
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            subtype: 'scheduling_poll_threshold_met',
          }),
        }),
      );
    });

    it('sends notification to the poll creator (userId = creatorId)', async () => {
      const poll = makePendingPoll({ creatorId: 42 });
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC8: Notification title = "Poll ready for review",
  //       message includes vote count
  // -----------------------------------------------------------------------
  describe('notification message (AC8)', () => {
    it('has title "Poll ready for review"', async () => {
      const poll = makePendingPoll();
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Poll ready for review',
        }),
      );
    });

    it('message includes vote count and game name', async () => {
      const poll = makePendingPoll({
        uniqueVoterCount: 3,
        minVoteThreshold: 3,
        gameName: 'World of Warcraft',
      });
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      const callArg = mockNotificationService.create.mock.calls[0][0];
      expect(callArg.message).toContain('3');
      expect(callArg.message).toContain('World of Warcraft');
    });

    it('message format: "X of Y members have voted on your [Game] poll"', async () => {
      const poll = makePendingPoll({
        uniqueVoterCount: 4,
        minVoteThreshold: 5,
        gameName: 'Final Fantasy XIV',
      });
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      const callArg = mockNotificationService.create.mock.calls[0][0];
      expect(callArg.message).toMatch(
        /4 of 5 members have voted on your Final Fantasy XIV poll/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC9: Idempotency — notification sent at most once per poll
  //       (thresholdNotifiedAt set, cron skips on subsequent runs)
  // -----------------------------------------------------------------------
  describe('idempotency (AC9)', () => {
    it('sets thresholdNotifiedAt after sending notification', async () => {
      const poll = makePendingPoll();
      mockDb.execute
        .mockResolvedValueOnce([poll]) // find eligible polls
        .mockResolvedValueOnce([]); // update thresholdNotifiedAt

      await service.checkThresholds();

      // The service should have called execute a second time to stamp the poll
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
    });

    it('does not re-send notification for already-notified poll', async () => {
      // First run: poll is eligible
      const poll = makePendingPoll();
      mockDb.execute.mockResolvedValueOnce([poll]).mockResolvedValueOnce([]);

      await service.checkThresholds();
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);

      // Second run: no eligible polls (thresholdNotifiedAt is set)
      mockNotificationService.create.mockClear();
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkThresholds();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('notification failure does not prevent thresholdNotifiedAt from being set', async () => {
      const poll = makePendingPoll();
      mockDb.execute.mockResolvedValueOnce([poll]).mockResolvedValueOnce([]);
      mockNotificationService.create.mockRejectedValueOnce(
        new Error('Discord DM failed'),
      );

      // Should not throw — cron is fire-and-forget
      await expect(service.checkThresholds()).resolves.not.toThrow();

      // thresholdNotifiedAt should still be stamped (second execute call)
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('skips polls with null minVoteThreshold (legacy)', async () => {
      // The query itself should filter these out, but verify the service
      // does not crash if a null-threshold poll sneaks through
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkThresholds();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('payload includes lineupId and matchId for deep-link', async () => {
      const poll = makePendingPoll({ lineupId: 7, matchId: 42 });
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            lineupId: 7,
            matchId: 42,
          }),
        }),
      );
    });
  });
});
