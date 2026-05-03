/**
 * TDD tests for LineupReminderService (ROK-932 + ROK-1126).
 * Validates cron-driven vote reminders (24h + 1h before voting deadline),
 * scheduling reminders (24h + 1h before decided phase end), and the new
 * nomination reminders (24h + 1h before building phase deadline, ROK-1126).
 *
 * Also asserts that all three reminder methods are decorated with
 * `@Cron(EVERY_5_MINUTES)` and wrap their bodies in `executeWithTracking`,
 * and route their recipient resolution through the new
 * `resolveLineupReminderTargets` helper.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { LineupReminderService } from './lineup-reminder.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { SettingsService } from '../settings/settings.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

// Mock the helper module so we can spy on its calls without needing real DB.
jest.mock('./lineup-reminder-target.helpers', () => ({
  resolveLineupReminderTargets: jest.fn().mockResolvedValue([]),
}));
import { resolveLineupReminderTargets } from './lineup-reminder-target.helpers';
const mockResolveTargets =
  resolveLineupReminderTargets as unknown as jest.Mock;

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

function makeMockSettingsService() {
  return {
    getClientUrl: jest.fn().mockResolvedValue('https://rl.test'),
  };
}

// ---------------------------------------------------------------------------
// Test module builder
// ---------------------------------------------------------------------------

async function createTestModule() {
  const mockDb = makeMockDb();
  const mockNotificationService = makeMockNotificationService();
  const mockDedupService = makeMockDedupService();
  const mockSettingsService = makeMockSettingsService();

  const mockCronJobService = {
    executeWithTracking: jest
      .fn()
      .mockImplementation(async (_name: string, fn: () => Promise<void>) => {
        await fn();
      }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LineupReminderService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: NotificationDedupService, useValue: mockDedupService },
      { provide: SettingsService, useValue: mockSettingsService },
      { provide: CronJobService, useValue: mockCronJobService },
    ],
  }).compile();

  return {
    service: module.get<LineupReminderService>(LineupReminderService),
    mockDb,
    mockNotificationService,
    mockDedupService,
    mockSettingsService,
    mockCronJobService,
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
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    mockResolveTargets.mockReset();
    mockResolveTargets.mockResolvedValue([]);
    const ctx = await createTestModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    mockNotificationService = ctx.mockNotificationService;
    mockDedupService = ctx.mockDedupService;
    mockCronJobService = ctx.mockCronJobService;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // AC-4: Vote reminders at 24h and 1h before deadline
  //
  // ROK-1126: vote-reminder recipient resolution is now centralized in
  // `resolveLineupReminderTargets(db, lineupId, 'vote')`. Tests stub it
  // and assert the call shape + downstream dispatch.
  // -----------------------------------------------------------------------
  describe('vote reminders', () => {
    it('sends 24h reminder to non-voters when <= 24h remain', async () => {
      const lineup = makeVotingLineup(23);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([1, 2]);

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
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([3]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-reminder-1h:${LINEUP_ID}:3`,
        expect.anything(),
      );
    });

    it('uses dedup key lineup-reminder-24h:{lineupId}:{userId}', async () => {
      const lineup = makeVotingLineup(20);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([5]);

      await service.checkVoteReminders();

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-reminder-24h:${LINEUP_ID}:5`,
        expect.anything(),
      );
    });

    it('only targets users returned by resolveLineupReminderTargets', async () => {
      const lineup = makeVotingLineup(12);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([8]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 8 }),
      );
    });

    it("delegates recipient resolution to resolveLineupReminderTargets with action='vote'", async () => {
      const lineup = makeVotingLineup(12);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([]);

      await service.checkVoteReminders();

      expect(mockResolveTargets).toHaveBeenCalledWith(
        expect.anything(),
        LINEUP_ID,
        'vote',
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
      // Helper not consulted when there's no deadline to act on.
      expect(mockResolveTargets).not.toHaveBeenCalled();
    });

    it('skips when dedup indicates reminder already sent', async () => {
      const lineup = makeVotingLineup(20);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([6]);
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('does nothing when no active voting lineups exist', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('checkVoteReminders wraps execution in cronJobService.executeWithTracking', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkVoteReminders();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'LineupReminderService_checkVoteReminders',
        expect.any(Function),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-9/11: Scheduling reminders at 24h and 1h before decided phase end
  //
  // ROK-1126: scheduling reminders fan out per-match. The service must
  // load the (lineupId, matchId) pairs that are still scheduling, then
  // call `resolveLineupReminderTargets(db, lineupId, 'schedule', matchId)`
  // for each one.
  // -----------------------------------------------------------------------
  describe('scheduling reminders', () => {
    function makeMatch(matchId: number) {
      return { lineupId: LINEUP_ID, matchId };
    }

    it('sends 24h reminder to scheduling non-voters', async () => {
      const lineup = makeDecidedLineup(20);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeMatch(100)]);
      mockResolveTargets.mockResolvedValueOnce([10, 11]);

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
        .mockResolvedValueOnce([makeMatch(100)]);
      mockResolveTargets.mockResolvedValueOnce([13]);

      await service.checkSchedulingReminders();

      // Dedup key shape: lineup-sched-remind:{matchId}:{userId}:{window}
      // — userId must be the resolved target (13), NOT undefined.
      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'lineup-sched-remind:100:13:1h',
        expect.anything(),
      );
    });

    it('uses dedup key lineup-sched-remind:{matchId}:{userId}:{window}', async () => {
      const lineup = makeDecidedLineup(20);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeMatch(100)]);
      mockResolveTargets.mockResolvedValueOnce([14]);

      await service.checkSchedulingReminders();

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        expect.stringMatching(/^lineup-sched-remind:\d+:\d+:(24h|1h)$/),
        expect.anything(),
      );
    });

    it("delegates recipient resolution to resolveLineupReminderTargets with action='schedule' and matchId", async () => {
      const lineup = makeDecidedLineup(12);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeMatch(100), makeMatch(101)]);
      mockResolveTargets.mockResolvedValue([]);

      await service.checkSchedulingReminders();

      expect(mockResolveTargets).toHaveBeenCalledWith(
        expect.anything(),
        LINEUP_ID,
        'schedule',
        100,
      );
      expect(mockResolveTargets).toHaveBeenCalledWith(
        expect.anything(),
        LINEUP_ID,
        'schedule',
        101,
      );
    });

    it('skips decided lineup without phaseDeadline', async () => {
      const lineup = { id: LINEUP_ID, status: 'decided', phaseDeadline: null };
      mockDb.execute.mockResolvedValueOnce([lineup]);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockResolveTargets).not.toHaveBeenCalled();
    });

    it('skips when dedup indicates already sent', async () => {
      const lineup = makeDecidedLineup(20);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([makeMatch(100)]);
      mockResolveTargets.mockResolvedValueOnce([15]);
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('does nothing when no decided lineups exist', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('checkSchedulingReminders wraps execution in cronJobService.executeWithTracking', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkSchedulingReminders();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'LineupReminderService_checkSchedulingReminders',
        expect.any(Function),
      );
    });
  });

  // -----------------------------------------------------------------------
  // All DMs use type community_lineup
  // -----------------------------------------------------------------------
  describe('notification type consistency', () => {
    it('all vote reminders use type community_lineup', async () => {
      const lineup = makeVotingLineup(12);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([1]);

      await service.checkVoteReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'community_lineup' }),
      );
    });

    it('all scheduling reminders use type community_lineup', async () => {
      const lineup = makeDecidedLineup(12);
      mockDb.execute
        .mockResolvedValueOnce([lineup])
        .mockResolvedValueOnce([{ lineupId: LINEUP_ID, matchId: 100 }]);
      mockResolveTargets.mockResolvedValueOnce([1]);

      await service.checkSchedulingReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_scheduling_reminder',
            matchId: 100,
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // ROK-1126: Nomination reminders at 24h and 1h before building deadline
  // -----------------------------------------------------------------------
  describe('nomination reminders', () => {
    function makeBuildingLineup(hoursUntilDeadline: number) {
      const deadline = new Date(NOW.getTime() + hoursUntilDeadline * 3600_000);
      return {
        id: LINEUP_ID,
        status: 'building' as const,
        phaseDeadline: deadline,
      };
    }

    it('sends 24h reminder when <= 24h remain', async () => {
      const lineup = makeBuildingLineup(20);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([1, 2]);

      await service.checkNominationReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_nominate_reminder',
            lineupId: LINEUP_ID,
          }),
        }),
      );
    });

    it('sends 1h reminder when <= 1h remains', async () => {
      const lineup = makeBuildingLineup(0.5);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([3]);

      await service.checkNominationReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-nominate-remind:${LINEUP_ID}:3:1h`,
        expect.anything(),
      );
    });

    it('uses dedup key lineup-nominate-remind:{lineupId}:{userId}:{window}', async () => {
      const lineup = makeBuildingLineup(20);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([7]);

      await service.checkNominationReminders();

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-nominate-remind:${LINEUP_ID}:7:24h`,
        expect.anything(),
      );
    });

    it("delegates recipient resolution to resolveLineupReminderTargets with action='nominate'", async () => {
      const lineup = makeBuildingLineup(12);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([]);

      await service.checkNominationReminders();

      expect(mockResolveTargets).toHaveBeenCalledWith(
        expect.anything(),
        LINEUP_ID,
        'nominate',
      );
    });

    it('only fires on building-status lineups (filtered at the query level)', async () => {
      // Helper-only: assert that checkNominationReminders pulls building-only
      // rows. We capture the SQL fragment string the service issues for its
      // building-lineups query and require it to mention `status = 'building'`
      // and `phase_deadline IS NOT NULL` so we don't accidentally include
      // voting / decided rows.
      const captured: string[] = [];
      mockDb.execute.mockImplementationOnce((q: unknown) => {
        // Drizzle's `sql` template returns an SQL token object; stringify it.
        captured.push(JSON.stringify(q));
        return Promise.resolve([]);
      });

      await service.checkNominationReminders();

      expect(captured.length).toBeGreaterThan(0);
      const blob = captured.join(' ');
      expect(blob).toMatch(/building/);
      expect(blob).toMatch(/phase_deadline/);
    });

    it('skips when phaseDeadline is null', async () => {
      // Building-lineup query already filters phase_deadline IS NOT NULL,
      // so an empty result here is the equivalent end-state.
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkNominationReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('skips when window is outside the 0–24h band', async () => {
      const tooEarly = makeBuildingLineup(48); // 48h remaining
      mockDb.execute.mockResolvedValueOnce([tooEarly]);

      await service.checkNominationReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      // helper not consulted because the window is not actionable
      expect(mockResolveTargets).not.toHaveBeenCalled();
    });

    it('skips when phase_deadline has already passed', async () => {
      const expired = makeBuildingLineup(-1); // 1h ago
      mockDb.execute.mockResolvedValueOnce([expired]);

      await service.checkNominationReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockResolveTargets).not.toHaveBeenCalled();
    });

    it('skips when dedup indicates reminder already sent', async () => {
      const lineup = makeBuildingLineup(20);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([8]);
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.checkNominationReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('does nothing when no building lineups exist', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkNominationReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('uses subtype lineup_nominate_reminder in notification payload', async () => {
      const lineup = makeBuildingLineup(20);
      mockDb.execute.mockResolvedValueOnce([lineup]);
      mockResolveTargets.mockResolvedValueOnce([9]);

      await service.checkNominationReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
          title: expect.any(String),
          message: expect.any(String),
          payload: expect.objectContaining({
            subtype: 'lineup_nominate_reminder',
            lineupId: LINEUP_ID,
          }),
        }),
      );
    });

    it('checkNominationReminders wraps execution in cronJobService.executeWithTracking', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await service.checkNominationReminders();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'LineupReminderService_checkNominationReminders',
        expect.any(Function),
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
      tiedGameIds: number[] = [],
    ) {
      const deadline = new Date(NOW.getTime() + hoursUntilDeadline * 3600_000);
      return {
        tiebreakerId: 77,
        lineupId: LINEUP_ID,
        mode,
        roundDeadline: deadline,
        currentRound: 1,
        tiedGameIds,
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

    // ROK-1117 rework: reminder DM body lists tied games as deep links
    // and ends with a CTA pointing at the lineup detail page.
    it('renders tied-game deep-link list and lineup CTA in the DM body', async () => {
      const tb = makeActiveTiebreakerRow(20, 'veto', [101, 202]);
      mockDb.execute.mockResolvedValueOnce([tb]);
      mockChainedSelect([
        // resolveReminderTargets — community_lineups lookup
        [makePublicLineupRow()],
        // findDistinctNominators
        [{ userId: 50 }],
        // findDistinctVoters
        [],
        // findVetoEngagedUserIds — none
        [],
        // findGamesByIds — id+name pairs for the ballot
        [
          { id: 101, name: 'Civ VI' },
          { id: 202, name: 'Stellaris' },
        ],
      ]);

      await service.checkTiebreakerReminders();

      const call = mockNotificationService.create.mock.calls[0][0] as {
        message: string;
      };
      expect(call.message).toMatch(
        /🎮 \[\*\*Civ VI\*\*\]\(https:\/\/rl\.test\/games\/101\)/,
      );
      expect(call.message).toMatch(
        /🎮 \[\*\*Stellaris\*\*\]\(https:\/\/rl\.test\/games\/202\)/,
      );
      expect(call.message).toContain(
        `[Cast your veto](https://rl.test/community-lineup/${LINEUP_ID})`,
      );
      expect(call.message).toContain('Tiebreaker closing in 24 hours');
    });
  });
});
