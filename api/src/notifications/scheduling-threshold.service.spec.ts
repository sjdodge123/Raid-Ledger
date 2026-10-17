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
  return {
    executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
      fn(),
    ),
  };
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

/** Flatten a Drizzle `sql` template back into the text it will send. */
function sqlTextOf(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join('');
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
  });

  // -----------------------------------------------------------------------
  // ROK-1632 AC2: the stamp is a receipt for an ACCEPTED send.
  // Stamping after a throw burns the only chance to notify the creator —
  // the poll is filtered out of every later sweep and the DM is lost.
  // -----------------------------------------------------------------------
  describe('stamp only after an accepted send (ROK-1632 AC2)', () => {
    it('does NOT stamp thresholdNotifiedAt when create() throws', async () => {
      const poll = makePendingPoll();
      mockDb.execute.mockResolvedValueOnce([poll]).mockResolvedValueOnce([]);
      mockNotificationService.create.mockRejectedValueOnce(
        new Error('Discord DM failed'),
      );

      // Still must not throw — cron is fire-and-forget.
      await expect(service.checkThresholds()).resolves.not.toThrow();

      const updates = mockDb.execute.mock.calls.filter((call) =>
        /UPDATE community_lineup_matches/.test(sqlTextOf(call[0])),
      );
      expect(updates).toHaveLength(0);
    });

    it('stamps thresholdNotifiedAt once create() resolves', async () => {
      const poll = makePendingPoll({ matchId: 77 });
      mockDb.execute.mockResolvedValueOnce([poll]).mockResolvedValueOnce([]);

      await service.checkThresholds();

      const updates = mockDb.execute.mock.calls.filter((call) =>
        /UPDATE community_lineup_matches/.test(sqlTextOf(call[0])),
      );
      expect(updates).toHaveLength(1);
      expect(sqlTextOf(updates[0][0])).toMatch(
        /threshold_notified_at = NOW\(\)/,
      );
    });

    it('stamps when create() resolves null (recipient prefs suppressed it)', async () => {
      // NotificationService.create returns null — not a throw — when the
      // creator disabled the category. That is a decided outcome, so it must
      // stamp; otherwise the cron re-queries this poll every 5 minutes forever.
      const poll = makePendingPoll();
      mockDb.execute.mockResolvedValueOnce([poll]).mockResolvedValueOnce([]);
      mockNotificationService.create.mockResolvedValueOnce(null);

      await service.checkThresholds();

      const updates = mockDb.execute.mock.calls.filter((call) =>
        /UPDATE community_lineup_matches/.test(sqlTextOf(call[0])),
      );
      expect(updates).toHaveLength(1);
    });

    it('keeps processing later polls after one send throws', async () => {
      const failing = makePendingPoll({ matchId: 10, creatorId: 100 });
      const ok = makePendingPoll({ matchId: 20, creatorId: 200 });
      mockDb.execute.mockResolvedValueOnce([failing, ok]);
      mockNotificationService.create.mockRejectedValueOnce(
        new Error('Discord DM failed'),
      );

      await service.checkThresholds();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      const updates = mockDb.execute.mock.calls.filter((call) =>
        /UPDATE community_lineup_matches/.test(sqlTextOf(call[0])),
      );
      expect(updates).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // ROK-1617: a `no` answer must not push a poll over its threshold
  // -----------------------------------------------------------------------
  describe('anti-votes (ROK-1617)', () => {
    /**
     * The voter count is computed in SQL, so a row fixture cannot prove the
     * rule (the fixture IS the count). Assert the query the service actually
     * issues: ONE yes-only count, used both for the message and for the
     * `>= min_vote_threshold` comparison. With 1 yes + 3 no and a threshold
     * of 3 the guard is what keeps the poll ineligible; drop it and the three
     * rejections alone would fire the DM.
     */
    it('counts YES answers only, once, for both the message and the gate', async () => {
      await service.checkThresholds();

      const text = sqlTextOf(mockDb.execute.mock.calls[0][0]);
      expect(text).toContain("v.stance = 'yes'");
      expect(text.match(/COUNT\(DISTINCT/g) ?? []).toHaveLength(1);
      expect(text).toMatch(/>=\s*eff\.min_votes/);
    });
  });

  // -----------------------------------------------------------------------
  // ROK-1632 AC1: a NULL min_vote_threshold means "every current member".
  // Only the standalone-poll path writes that column, so lineup-born polls
  // carry NULL and the old `IS NOT NULL` gate made their DM impossible.
  // The count is computed in SQL, so the query text IS the behaviour here.
  // -----------------------------------------------------------------------
  describe('NULL threshold = all current members (ROK-1632 AC1)', () => {
    function eligibilitySql(): string {
      return sqlTextOf(mockDb.execute.mock.calls[0][0]);
    }

    it('no longer excludes matches whose min_vote_threshold is NULL', async () => {
      await service.checkThresholds();

      expect(eligibilitySql()).not.toMatch(/min_vote_threshold IS NOT NULL/);
    });

    it('falls back to the live member count and requires it to be > 0', async () => {
      await service.checkThresholds();

      const text = eligibilitySql();
      expect(text).toMatch(/COALESCE\(\s*m\.min_vote_threshold/);
      expect(text).toMatch(/FROM community_lineup_match_members/);
      expect(text).toMatch(/eff\.min_votes\s*>\s*0/);
    });

    it('selects the EFFECTIVE threshold as "minVoteThreshold"', async () => {
      // buildThresholdNotification renders "N of M" from this column, so the
      // gate and the message must read the same effective value.
      await service.checkThresholds();

      expect(eligibilitySql()).toMatch(
        /eff\.min_votes::int AS "minVoteThreshold"/,
      );
    });

    it('passes the effective threshold through to the rendered message', async () => {
      // 3 of 3 members voted on a lineup-born poll: the row the query returns
      // already carries the resolved count, so the DM reads "3 of 3".
      const poll = makePendingPoll({
        minVoteThreshold: 3,
        uniqueVoterCount: 3,
        gameName: 'Deep Rock Galactic',
      });
      mockDb.execute.mockResolvedValueOnce([poll]);

      await service.checkThresholds();

      const callArg = mockNotificationService.create.mock.calls[0][0];
      expect(callArg.message).toBe(
        '3 of 3 members have voted on your Deep Rock Galactic poll',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('sends nothing when the query returns no eligible polls', async () => {
      // ROK-1632: a NULL min_vote_threshold is no longer a skip reason (the
      // member count stands in). A memberless match still yields no row,
      // because the effective threshold would be 0.
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
