/**
 * TDD tests for LineupReminderService (ROK-932).
 * Validates cron-driven vote reminders (24h + 1h before voting deadline)
 * and scheduling reminders (24h + 1h before decided phase end).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LineupReminderService } from './lineup-reminder.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

function makeMockDb() {
  return { execute: jest.fn().mockResolvedValue([]) };
}

function makeMockNotificationService() {
  return { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
}

function makeMockDedupService() {
  return { checkAndMarkSent: jest.fn().mockResolvedValue(false) };
}

// ---------------------------------------------------------------------------
// Test module builder
// ---------------------------------------------------------------------------

async function createTestModule() {
  const mockDb = makeMockDb();
  const mockNotificationService = makeMockNotificationService();
  const mockDedupService = makeMockDedupService();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LineupReminderService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: NotificationDedupService, useValue: mockDedupService },
    ],
  }).compile();

  return {
    service: module.get<LineupReminderService>(LineupReminderService),
    mockDb,
    mockNotificationService,
    mockDedupService,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINEUP_ID = 42;
const NOW = new Date('2026-04-10T12:00:00Z');

function makeVotingLineup(hoursUntilDeadline: number) {
  const deadline = new Date(NOW.getTime() + hoursUntilDeadline * 3600_000);
  return {
    id: LINEUP_ID,
    status: 'voting' as const,
    phaseDeadline: deadline,
    votingDeadline: deadline,
  };
}

function makeDecidedLineup(hoursUntilDeadline: number) {
  const deadline = new Date(NOW.getTime() + hoursUntilDeadline * 3600_000);
  return {
    id: LINEUP_ID,
    status: 'decided' as const,
    phaseDeadline: deadline,
  };
}

function makeNonVoter(id: number) {
  return { id, userId: id, displayName: `Player${id}`, discordId: `d-${id}` };
}

function makeSchedulingNonVoter(id: number) {
  return { id, userId: id, displayName: `Player${id}`, matchId: 100 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LineupReminderService', () => {
  let service: LineupReminderService;
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockNotificationService: ReturnType<typeof makeMockNotificationService>;
  let mockDedupService: ReturnType<typeof makeMockDedupService>;

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    const ctx = await createTestModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    mockNotificationService = ctx.mockNotificationService;
    mockDedupService = ctx.mockDedupService;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // AC-4: Vote reminders at 24h and 1h before deadline
  // -----------------------------------------------------------------------
  describe('vote reminders', () => {
    it('sends 24h reminder to non-voters when <= 24h remain', async () => {
      const lineup = makeVotingLineup(23);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeNonVoter(1), makeNonVoter(2)]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_vote_reminder',
          }),
        }),
      );
    });

    it('sends 1h reminder to non-voters when <= 1h remains', async () => {
      const lineup = makeVotingLineup(0.5);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeNonVoter(3)]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-reminder-1h:${LINEUP_ID}:3`,
        expect.anything(),
      );
    });

    it('uses dedup key lineup-reminder-24h:{lineupId}:{userId}', async () => {
      const lineup = makeVotingLineup(20);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeNonVoter(5)]);

      await service.checkVoteReminders();

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-reminder-24h:${LINEUP_ID}:5`,
        expect.anything(),
      );
    });

    it('only targets users who have not yet voted', async () => {
      const lineup = makeVotingLineup(12);
      // First call returns lineup, second returns non-voter list
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeNonVoter(8)]);

      await service.checkVoteReminders();

      // Only user 8 should receive a reminder
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 8 }),
      );
    });

    it('skips lineup without phaseDeadline', async () => {
      const lineup = {
        id: LINEUP_ID,
        status: 'voting' as const,
        phaseDeadline: null,
        votingDeadline: null,
      };
      mockDb.execute.mockResolvedValueOnce([lineup]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('skips when dedup indicates reminder already sent', async () => {
      const lineup = makeVotingLineup(20);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeNonVoter(6)]);
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('does nothing when no active voting lineups exist', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // AC-9/11: Scheduling reminders at 24h and 1h before decided phase end
  // -----------------------------------------------------------------------
  describe('scheduling reminders', () => {
    it('sends 24h reminder to scheduling non-voters', async () => {
      const lineup = makeDecidedLineup(20);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([
          makeSchedulingNonVoter(10),
          makeSchedulingNonVoter(11),
        ]);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_scheduling_reminder',
          }),
        }),
      );
    });

    it('sends 1h reminder when <= 1h remains', async () => {
      const lineup = makeDecidedLineup(0.5);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeSchedulingNonVoter(13)]);

      await service.checkSchedulingReminders();

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        expect.stringContaining('lineup-sched-remind:'),
        expect.anything(),
      );
    });

    it('uses dedup key lineup-sched-remind:{matchId}:{userId}:{window}', async () => {
      const lineup = makeDecidedLineup(20);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeSchedulingNonVoter(14)]);

      await service.checkSchedulingReminders();

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        expect.stringMatching(/^lineup-sched-remind:\d+:\d+:(24h|1h)$/),
        expect.anything(),
      );
    });

    it('skips decided lineup without phaseDeadline', async () => {
      const lineup = { id: LINEUP_ID, status: 'decided', phaseDeadline: null };
      mockDb.execute.mockResolvedValueOnce([lineup]);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('skips when dedup indicates already sent', async () => {
      const lineup = makeDecidedLineup(20);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeSchedulingNonVoter(15)]);
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('does nothing when no decided lineups exist', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // All DMs use type community_lineup
  // -----------------------------------------------------------------------
  describe('notification type consistency', () => {
    it('all vote reminders use type community_lineup', async () => {
      const lineup = makeVotingLineup(12);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeNonVoter(1)]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'community_lineup' }),
      );
    });

    it('all scheduling reminders use type community_lineup', async () => {
      const lineup = makeDecidedLineup(12);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeSchedulingNonVoter(1)]);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'community_lineup' }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // ROK-1117: Tiebreaker reminders at 24h and 1h before round deadline
  // -----------------------------------------------------------------------
  describe('tiebreaker reminders', () => {
    function makeActiveTiebreakerRow(
      hoursUntilDeadline: number,
      mode: 'bracket' | 'veto' = 'bracket',
    ) {
      const deadline = new Date(NOW.getTime() + hoursUntilDeadline * 3600_000);
      return {
        tiebreakerId: 77,
        lineupId: LINEUP_ID,
        mode,
        roundDeadline: deadline,
        currentRound: 1,
      };
    }

    function makePublicLineupRow() {
      return {
        id: LINEUP_ID,
        visibility: 'public',
        createdBy: 100,
      };
    }

    function makePrivateLineupRow() {
      return {
        id: LINEUP_ID,
        visibility: 'private',
        createdBy: 100,
      };
    }

    /**
     * Mock the chained `.select().from().where().limit()` pattern used by
     * `loadExpectedVoters` and `resolveReminderTargets`. We sequence the
     * resolved values so each call returns a specific result.
     */
    function mockChainedSelect(results: unknown[][]) {
      let i = 0;
      const select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => {
            const result = results[i] ?? [];
            const ret = {
              limit: jest.fn().mockResolvedValue(result),
              then: (resolve: (v: unknown[]) => unknown) => resolve(result),
            };
            i += 1;
            return ret;
          }),
        })),
      }));
      (mockDb as unknown as { select: jest.Mock }).select = select;
    }

    it('fires 24h threshold for active tiebreakers approaching deadline', async () => {
      const tb = makeActiveTiebreakerRow(20);
      mockDb.execute
        // findActiveTiebreakersWithDeadline
        .mockResolvedValueOnce([tb])
        // loadVoteCountsPerUser (bracket mode, no votes yet)
        .mockResolvedValueOnce([]);
      mockChainedSelect([
        // resolveReminderTargets — community_lineups lookup
        [makePublicLineupRow()],
        // findDistinctNominators
        [{ userId: 1 }],
        // findDistinctVoters
        [{ userId: 2 }],
        // findBracketEngagedUserIds — countActiveRoundMatchups (no matchups)
        [],
      ]);

      await service.checkTiebreakerReminders();

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        expect.stringContaining('tiebreaker-reminder:77:24h:'),
        expect.anything(),
      );
      expect(mockNotificationService.create).toHaveBeenCalled();
    });

    it('fires 1h threshold when <= 1h remains', async () => {
      const tb = makeActiveTiebreakerRow(0.5);
      mockDb.execute.mockResolvedValueOnce([tb]).mockResolvedValueOnce([]); // bracket vote counts
      mockChainedSelect([
        [makePublicLineupRow()],
        [{ userId: 5 }],
        [{ userId: 6 }],
        [], // no matchups
      ]);

      await service.checkTiebreakerReminders();

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        expect.stringContaining('tiebreaker-reminder:77:1h:'),
        expect.anything(),
      );
    });

    it('is a no-op when no active tiebreakers exist', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkTiebreakerReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('skips users who have already vetoed (veto mode)', async () => {
      const tb = makeActiveTiebreakerRow(20, 'veto');
      mockDb.execute.mockResolvedValueOnce([tb]);
      mockChainedSelect([
        [makePublicLineupRow()],
        [{ userId: 7 }, { userId: 8 }], // nominators
        [], // voters
        [{ userId: 7 }], // already vetoed
      ]);

      await service.checkTiebreakerReminders();

      // Only user 8 receives a reminder (user 7 already engaged)
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 8 }),
      );
    });

    it('targets nominators ∪ voters minus already-engaged for public lineup', async () => {
      const tb = makeActiveTiebreakerRow(12, 'veto');
      mockDb.execute.mockResolvedValueOnce([tb]);
      mockChainedSelect([
        [makePublicLineupRow()],
        [{ userId: 11 }], // nominator
        [{ userId: 12 }, { userId: 11 }], // voters (11 also voted)
        [], // no vetoes yet
      ]);

      await service.checkTiebreakerReminders();

      const targets = mockNotificationService.create.mock.calls.map(
        (c) => (c[0] as { userId: number }).userId,
      );
      expect(new Set(targets)).toEqual(new Set([11, 12]));
    });

    it('targets invitees + creator minus already-engaged for private lineup', async () => {
      const tb = makeActiveTiebreakerRow(12, 'veto');
      mockDb.execute.mockResolvedValueOnce([tb]);
      mockChainedSelect([
        [makePrivateLineupRow()],
        // private branch: invitees query
        [{ userId: 21 }, { userId: 22 }],
        [], // no vetoes
      ]);

      await service.checkTiebreakerReminders();

      const targets = mockNotificationService.create.mock.calls.map(
        (c) => (c[0] as { userId: number }).userId,
      );
      // creator (100) + invitees (21, 22)
      expect(new Set(targets)).toEqual(new Set([100, 21, 22]));
    });

    it('dedup key prevents double-fire for the same threshold', async () => {
      const tb = makeActiveTiebreakerRow(20, 'veto');
      mockDb.execute.mockResolvedValueOnce([tb]);
      mockChainedSelect([[makePublicLineupRow()], [{ userId: 30 }], [], []]);
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.checkTiebreakerReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('uses subtype lineup_tiebreaker_reminder in notification payload', async () => {
      const tb = makeActiveTiebreakerRow(20, 'veto');
      mockDb.execute.mockResolvedValueOnce([tb]);
      mockChainedSelect([[makePublicLineupRow()], [{ userId: 40 }], [], []]);

      await service.checkTiebreakerReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_tiebreaker_reminder',
            tiebreakerId: 77,
            threshold: '24h',
          }),
        }),
      );
    });
  });
});
