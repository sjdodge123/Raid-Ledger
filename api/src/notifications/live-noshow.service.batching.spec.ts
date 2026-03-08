import { Test, TestingModule } from '@nestjs/testing';
import { LiveNoShowService } from './live-noshow.service';
import { NotificationService } from './notification.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';

/**
 * Build a select chain where .from().where().limit() is the terminal,
 * with support for optional .innerJoin() in the middle.
 */
function makeSelectFromWhereLimit(resolvedValue: unknown[]) {
  const limitChain = {
    limit: jest.fn().mockResolvedValue(resolvedValue),
    where: jest.fn(),
    innerJoin: jest.fn(),
  };
  limitChain.where.mockReturnValue(limitChain);
  limitChain.innerJoin.mockReturnValue(limitChain);
  return {
    from: jest.fn().mockReturnValue(limitChain),
  };
}

/**
 * Build a select chain where .from().where() is the terminal (no .limit()).
 * Used for batch queries that return all matching rows.
 */
function makeSelectFromWhere(resolvedValue: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

/**
 * Build a select chain for batch roster query: .from().innerJoin().where()
 */
function makeSelectFromJoinWhere(resolvedValue: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      innerJoin: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

describe('LiveNoShowService — batching', () => {
  let service: LiveNoShowService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  let mockCronJobService: { executeWithTracking: jest.Mock };
  let mockVoiceAttendance: { isUserActive: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
    };

    mockNotificationService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    };

    mockCronJobService = {
      executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
        fn(),
      ),
    };

    mockVoiceAttendance = {
      isUserActive: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveNoShowService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: CronJobService, useValue: mockCronJobService },
        { provide: VoiceAttendanceService, useValue: mockVoiceAttendance },
      ],
    }).compile();

    service = module.get<LiveNoShowService>(LiveNoShowService);
  });

  // --- checkNoShows (cron entry point) ---

  describe('Phase sequencing', () => {
    it('should run both Phase 1 and Phase 2 when event is past 15 min mark', async () => {
      // 16 min old -- past both thresholds
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      mockDb.select
        // findLiveEventsInNoShowWindow
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: 42,
              title: 'Raid',
              creatorId: 1,
              duration: [startTime, endTime],
            },
          ]),
        )
        // Phase 2: hasReminderBeenSent -- already escalated, skip rest of Phase 2
        .mockReturnValueOnce(
          jest.fn().mockReturnValue(makeSelectFromWhereLimit([{ id: 99 }]))(),
        )
        // Phase 1: fetchNonBenchSignups
        .mockReturnValueOnce(makeSelectFromWhere([]));

      await service.checkNoShows();

      // Phase 2 dedup check + Phase 1 signups query + findLiveEvents
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it('should only run Phase 1 when event is between 5-15 min old', async () => {
      const startTime = new Date(Date.now() - 12 * 60 * 1000); // 12 min old
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      mockDb.select
        // findLiveEventsInNoShowWindow
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: 42,
              title: 'Raid',
              creatorId: 1,
              duration: [startTime, endTime],
            },
          ]),
        )
        // Phase 1: fetchNonBenchSignups
        .mockReturnValueOnce(makeSelectFromWhere([]));

      await service.checkNoShows();

      // findLiveEvents + Phase 1 signups query (no Phase 2 dedup check)
      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // --- Multi-player Phase 2 batching ---

  describe('Phase 2 multi-player batching', () => {
    it('should batch multiple absent players into a single creator DM', async () => {
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      const selectCalls: jest.Mock[] = [
        // findLiveEventsInNoShowWindow
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            {
              id: 42,
              title: 'Raid Night',
              creatorId: 1,
              duration: [startTime, endTime],
            },
          ]),
        ),
        // hasReminderBeenSent (escalation) -- not sent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
        // getPhase1RemindedUserIds -- two players
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhere([{ userId: 10 }, { userId: 11 }]),
          ),
        // fetchPhase2Data: batch discord IDs
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            { id: 10, discordId: 'discord-10' },
            { id: 11, discordId: 'discord-11' },
          ]),
        ),
        // fetchPhase2Data: batch voice sessions -- both absent
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // batchFetchPlayerDisplayInfo: batch user lookup
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            { id: 10, username: 'PlayerOne', displayName: 'PlayerOne' },
            { id: 11, username: 'PlayerTwo', displayName: 'PlayerTwo' },
          ]),
        ),
        // batchFetchPlayerDisplayInfo: batch roster assignment
        jest.fn().mockReturnValue(
          makeSelectFromJoinWhere([
            { userId: 10, role: 'Tank' },
            { userId: 11, role: 'Healer' },
          ]),
        ),
        // Phase 1: fetchNonBenchSignups
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
      ];

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const m = selectCalls[callIdx++];
        if (!m) return makeSelectFromWhere([]);
        return m() as unknown;
      });

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await service.checkNoShows();

      // Should be exactly ONE creator DM (batched)
      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCalls).toHaveLength(1);

      const payload = (
        nudgeCalls[0][0] as {
          payload: { absentPlayers: Array<{ userId: number }> };
        }
      ).payload;
      expect(payload.absentPlayers).toHaveLength(2);
      expect(payload.absentPlayers.map((p) => p.userId)).toEqual(
        expect.arrayContaining([10, 11]),
      );
    });

    it('should use plural message format for multiple absent players', async () => {
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      const selectCalls: jest.Mock[] = [
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            {
              id: 42,
              title: 'Raid Night',
              creatorId: 1,
              duration: [startTime, endTime],
            },
          ]),
        ),
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])), // hasReminderBeenSent
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhere([{ userId: 10 }, { userId: 11 }]),
          ),
        // fetchPhase2Data: batch discord IDs
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            { id: 10, discordId: 'discord-10' },
            { id: 11, discordId: 'discord-11' },
          ]),
        ),
        // fetchPhase2Data: batch voice sessions
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // batchFetchPlayerDisplayInfo: users
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            { id: 10, username: 'Alpha', displayName: 'Alpha' },
            { id: 11, username: 'Beta', displayName: 'Beta' },
          ]),
        ),
        // batchFetchPlayerDisplayInfo: roster assignments
        jest.fn().mockReturnValue(makeSelectFromJoinWhere([])),
        // Phase 1: fetchNonBenchSignups
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
      ];

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const m = selectCalls[callIdx++];
        if (!m) return makeSelectFromWhere([]);
        return m() as unknown;
      });

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await service.checkNoShows();

      const nudgeCall = mockNotificationService.create.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      const msg = (nudgeCall![0] as { message: string }).message;
      // Plural format: "2 players haven't shown up..."
      expect(msg).toMatch(/2 players haven't shown up/);
      expect(msg).toContain('Their slots are available to PUG');
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('should skip Phase 1 for players without discordUserId', async () => {
      const startTime = new Date(Date.now() - 11 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: 42,
              title: 'Raid Night',
              creatorId: 1,
              duration: [startTime, endTime],
            },
          ]),
        )
        // fetchNonBenchSignups
        .mockReturnValueOnce(
          makeSelectFromWhere([
            { userId: 10, discordUserId: null, discordUsername: null },
          ]),
        )
        // batchResolveDiscordIds: user has null discordId
        .mockReturnValueOnce(makeSelectFromWhere([{ id: 10, discordId: null }]))
        // batchFetchVoiceSessions
        .mockReturnValueOnce(makeSelectFromWhere([]));

      await service.checkNoShows();

      expect(mockVoiceAttendance.isUserActive).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should handle checkVoicePresence gracefully when user has no discordId in users table', async () => {
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      const selectCalls: jest.Mock[] = [
        // findLiveEventsInNoShowWindow
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            {
              id: 42,
              title: 'Raid Night',
              creatorId: 1,
              duration: [startTime, endTime],
            },
          ]),
        ),
        // hasReminderBeenSent -- not sent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
        // getPhase1RemindedUserIds
        jest.fn().mockReturnValue(makeSelectFromWhere([{ userId: 10 }])),
        // fetchPhase2Data: batch discord IDs -- user has null discordId
        jest
          .fn()
          .mockReturnValue(makeSelectFromWhere([{ id: 10, discordId: null }])),
        // fetchPhase2Data: batch voice sessions -- no sessions
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // batchFetchPlayerDisplayInfo: user lookup
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhere([
              { id: 10, username: 'PlayerOne', displayName: 'PlayerOne' },
            ]),
          ),
        // batchFetchPlayerDisplayInfo: roster assignment
        jest.fn().mockReturnValue(makeSelectFromJoinWhere([])),
        // Phase 1: fetchNonBenchSignups
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
      ];

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const m = selectCalls[callIdx++];
        if (!m) return makeSelectFromWhere([]);
        return m() as unknown;
      });

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await service.checkNoShows();

      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCalls).toHaveLength(1);
      expect((nudgeCalls[0][0] as { userId: number }).userId).toBe(1);
    });

    it('should handle user not found in users table during Phase 2 voice check', async () => {
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      const selectCalls: jest.Mock[] = [
        // findLiveEventsInNoShowWindow
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            {
              id: 42,
              title: 'Raid Night',
              creatorId: 1,
              duration: [startTime, endTime],
            },
          ]),
        ),
        // hasReminderBeenSent -- not sent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
        // getPhase1RemindedUserIds
        jest.fn().mockReturnValue(makeSelectFromWhere([{ userId: 10 }])),
        // fetchPhase2Data: batch discord IDs -- user not found
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // fetchPhase2Data: batch voice sessions -- no sessions
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // batchFetchPlayerDisplayInfo: user lookup (not found -- falls back to 'Unknown')
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // batchFetchPlayerDisplayInfo: roster assignment
        jest.fn().mockReturnValue(makeSelectFromJoinWhere([])),
        // Phase 1: fetchNonBenchSignups
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
      ];

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const m = selectCalls[callIdx++];
        if (!m) return makeSelectFromWhere([]);
        return m() as unknown;
      });

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await service.checkNoShows();

      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCalls).toHaveLength(1);
      const payload = (
        nudgeCalls[0][0] as {
          payload: { absentPlayers: Array<{ displayName: string }> };
        }
      ).payload;
      expect(payload.absentPlayers[0].displayName).toBe('Unknown');
    });

    it('should process multiple live events independently', async () => {
      const now = Date.now();
      const event1StartTime = new Date(now - 11 * 60 * 1000);
      const event1EndTime = new Date(
        event1StartTime.getTime() + 2 * 60 * 60 * 1000,
      );
      const event2StartTime = new Date(now - 12 * 60 * 1000);
      const event2EndTime = new Date(
        event2StartTime.getTime() + 2 * 60 * 60 * 1000,
      );

      mockDb.select
        // findLiveEventsInNoShowWindow -- returns 2 events
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: 1,
              title: 'Event One',
              creatorId: 10,
              duration: [event1StartTime, event1EndTime],
            },
            {
              id: 2,
              title: 'Event Two',
              creatorId: 20,
              duration: [event2StartTime, event2EndTime],
            },
          ]),
        )
        // Phase 1 for event 1: fetchNonBenchSignups -- no players
        .mockReturnValueOnce(makeSelectFromWhere([]))
        // Phase 1 for event 2: fetchNonBenchSignups -- no players
        .mockReturnValueOnce(makeSelectFromWhere([]));

      await service.checkNoShows();

      // Both events processed, no notifications (no absent players)
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });
});
