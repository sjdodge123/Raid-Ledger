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

describe('LiveNoShowService — batching', () => {
  let service: LiveNoShowService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  let mockCronJobService: { executeWithTracking: jest.Mock };
  let mockVoiceAttendance: { isUserActive: jest.Mock };

  const makeEvent = (
    overrides: Partial<{
      id: number;
      title: string;
      creatorId: number;
      startTime: Date;
      endTime: Date;
    }> = {},
  ) => {
    const startTime =
      overrides.startTime ?? new Date(Date.now() - 12 * 60 * 1000);
    const endTime =
      overrides.endTime ?? new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
    return {
      id: overrides.id ?? 42,
      title: overrides.title ?? 'Raid Night',
      creatorId: overrides.creatorId ?? 1,
      startTime,
      endTime,
    };
  };

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

  // ─── checkNoShows (cron entry point) ─────────────────────────────────────

  describe('Phase sequencing', () => {
    it('should run both Phase 1 and Phase 2 when event is past 15 min mark', async () => {
      // 16 min old — past both thresholds
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      mockDb.select
        // findLiveEventsInNoShowWindow
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                id: 42,
                title: 'Raid',
                creatorId: 1,
                duration: [startTime, endTime],
              },
            ]),
          }),
        })
        // Phase 2: hasReminderBeenSent — already escalated, skip rest of Phase 2
        .mockReturnValueOnce(
          jest.fn().mockReturnValue(makeSelectFromWhereLimit([{ id: 99 }]))(),
        )
        // Phase 1: signups query
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      await service.checkNoShows();

      // Phase 2 dedup check should have been called (hasReminderBeenSent)
      // Phase 1 signups query should also have been called
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it('should only run Phase 1 when event is between 5-15 min old', async () => {
      const startTime = new Date(Date.now() - 12 * 60 * 1000); // 12 min old
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      mockDb.select
        // findLiveEventsInNoShowWindow
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                id: 42,
                title: 'Raid',
                creatorId: 1,
                duration: [startTime, endTime],
              },
            ]),
          }),
        })
        // Phase 1: signups query
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      await service.checkNoShows();

      // Only findLiveEventsInNoShowWindow + Phase 1 signups query (no Phase 2 dedup check)
      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // ─── Multi-player Phase 2 batching ───────────────────────────────────────

  describe('Phase 2 multi-player batching', () => {
    it('should batch multiple absent players into a single creator DM', async () => {
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      const selectCalls: jest.Mock[] = [
        // findLiveEventsInNoShowWindow
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                id: 42,
                title: 'Raid Night',
                creatorId: 1,
                duration: [startTime, endTime],
              },
            ]),
          }),
        }),
        // hasReminderBeenSent (escalation) — not sent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
        // getPhase1RemindedUserIds — two players
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ userId: 10 }, { userId: 11 }]),
          }),
        }),
        // Batch-fetch discord IDs for reminded users
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            { id: 10, discordId: 'discord-10' },
            { id: 11, discordId: 'discord-11' },
          ]),
        ),
        // Batch-fetch voice sessions — both absent
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // getPlayerDisplayInfo for player 10: user
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([
              { username: 'PlayerOne', displayName: 'PlayerOne' },
            ]),
          ),
        // getPlayerDisplayInfo for player 10: roster assignment
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{ role: 'Tank' }]),
              }),
            }),
          }),
        }),
        // getPlayerDisplayInfo for player 11: user
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([
              { username: 'PlayerTwo', displayName: 'PlayerTwo' },
            ]),
          ),
        // getPlayerDisplayInfo for player 11: roster assignment
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{ role: 'Healer' }]),
              }),
            }),
          }),
        }),
        // Phase 1: signups query
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      ];

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const m = selectCalls[callIdx++];
        if (!m)
          return {
            from: jest
              .fn()
              .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
          };
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
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                id: 42,
                title: 'Raid Night',
                creatorId: 1,
                duration: [startTime, endTime],
              },
            ]),
          }),
        }),
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])), // hasReminderBeenSent
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ userId: 10 }, { userId: 11 }]),
          }),
        }),
        // Batch-fetch discord IDs for reminded users
        jest.fn().mockReturnValue(
          makeSelectFromWhere([
            { id: 10, discordId: 'discord-10' },
            { id: 11, discordId: 'discord-11' },
          ]),
        ),
        // Batch-fetch voice sessions — both absent
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([
              { username: 'Alpha', displayName: 'Alpha' },
            ]),
          ),
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([
              { username: 'Beta', displayName: 'Beta' },
            ]),
          ),
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
        jest.fn().mockReturnValue({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }),
      ];

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const m = selectCalls[callIdx++];
        if (!m)
          return {
            from: jest
              .fn()
              .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
          };
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

  // ─── Edge cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should skip Phase 1 for players without discordUserId', async () => {
      const event = makeEvent({
        startTime: new Date(Date.now() - 11 * 60 * 1000),
      });

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                id: event.id,
                title: event.title,
                creatorId: event.creatorId,
                duration: [event.startTime, event.endTime],
              },
            ]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([
                { userId: 10, discordUserId: null, discordUsername: null },
              ]),
          }),
        })
        // Fallback user lookup — user also has no discordId
        .mockReturnValueOnce(makeSelectFromWhereLimit([{ discordId: null }]));

      await service.checkNoShows();

      // No voice presence check and no notification for users with no discordUserId
      expect(mockVoiceAttendance.isUserActive).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should handle checkVoicePresence gracefully when user has no discordId in users table', async () => {
      // When user.discordId is null, checkVoicePresence returns false (treated as absent).
      // The service still calls getPlayerDisplayInfo for the absent player and sends the nudge.
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      const selectCalls: jest.Mock[] = [
        // findLiveEventsInNoShowWindow
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                id: 42,
                title: 'Raid Night',
                creatorId: 1,
                duration: [startTime, endTime],
              },
            ]),
          }),
        }),
        // hasReminderBeenSent — not sent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
        // getPhase1RemindedUserIds
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ userId: 10 }]),
          }),
        }),
        // Batch-fetch discord IDs — user has null discordId
        jest
          .fn()
          .mockReturnValue(makeSelectFromWhere([{ id: 10, discordId: null }])),
        // Batch-fetch voice sessions — no sessions
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // getPlayerDisplayInfo: user lookup
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([
              { username: 'PlayerOne', displayName: 'PlayerOne' },
            ]),
          ),
        // getPlayerDisplayInfo: roster assignment
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
        // Phase 1 signups
        jest.fn().mockReturnValue({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }),
      ];

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const m = selectCalls[callIdx++];
        if (!m)
          return {
            from: jest
              .fn()
              .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
          };
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

      // Should not throw — user with no discordId is treated as absent and included in nudge
      await service.checkNoShows();

      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCalls).toHaveLength(1);
      expect((nudgeCalls[0][0] as { userId: number }).userId).toBe(1); // creator receives nudge
    });

    it('should handle user not found in users table during Phase 2 voice check', async () => {
      // When user record is not found in batch, they have no discordId → treated as absent.
      // The service still calls getPlayerDisplayInfo and sends the nudge.
      const startTime = new Date(Date.now() - 16 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      const selectCalls: jest.Mock[] = [
        // findLiveEventsInNoShowWindow
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                id: 42,
                title: 'Raid Night',
                creatorId: 1,
                duration: [startTime, endTime],
              },
            ]),
          }),
        }),
        // hasReminderBeenSent — not sent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
        // getPhase1RemindedUserIds
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ userId: 10 }]),
          }),
        }),
        // Batch-fetch discord IDs — user not found (empty result)
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // Batch-fetch voice sessions — no sessions
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // getPlayerDisplayInfo: user lookup (also not found — falls back to 'Unknown')
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
        // getPlayerDisplayInfo: roster assignment
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
        // Phase 1 signups
        jest.fn().mockReturnValue({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }),
      ];

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const m = selectCalls[callIdx++];
        if (!m)
          return {
            from: jest
              .fn()
              .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
          };
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

      // Should not throw
      await service.checkNoShows();

      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      // Creator still receives a nudge with "Unknown" as display name
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
        // findLiveEventsInNoShowWindow — returns 2 events
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
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
          }),
        })
        // Phase 1 for event 1: signups — no absent players
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        })
        // Phase 1 for event 2: signups — no absent players
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        });

      await service.checkNoShows();

      // Both events processed, no notifications (no absent players)
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });
});
