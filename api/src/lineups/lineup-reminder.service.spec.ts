/**
 * TDD tests for LineupReminderService (ROK-932).
 * Validates cron-driven vote reminders (24h + 1h before voting deadline)
 * and scheduling reminders (24h + 1h before decided phase end).
 *
 * These tests are written BEFORE implementation -- they must all FAIL.
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
});
