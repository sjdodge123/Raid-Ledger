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

describe('LiveNoShowService — phase2', () => {
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

  describe('Phase 2 (creator escalation at +15 min)', () => {
    /**
     * Helper: build DB mocks for a full Phase 1 + Phase 2 flow.
     * Event is 16 min old (past both thresholds).
     * One player was reminded in Phase 1 and is still absent.
     */
    const setupPhase2Flow = (
      options: {
        alreadyEscalated?: boolean;
        phase1Reminded?: number[];
        voiceActiveForUser?: boolean;
        userDiscordId?: string | null;
        dbVoiceDuration?: number | null;
        displayName?: string;
        role?: string | null;
      } = {},
    ) => {
      const {
        alreadyEscalated = false,
        phase1Reminded = [10],
        voiceActiveForUser = false,
        userDiscordId = 'discord-10',
        dbVoiceDuration = null,
        displayName = 'PlayerOne',
        role = 'Tank',
      } = options;

      const event = makeEvent({
        startTime: new Date(Date.now() - 16 * 60 * 1000),
        creatorId: 1,
      });

      const selectMocks: jest.Mock[] = [];

      // 1. findLiveEventsInNoShowWindow
      selectMocks.push(
        jest.fn().mockReturnValue({
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
        }),
      );

      // --- Phase 2 first ---

      // 2. hasReminderBeenSent (noshow_escalation) — .limit(1)
      selectMocks.push(
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit(alreadyEscalated ? [{ id: 99 }] : []),
          ),
      );

      if (!alreadyEscalated) {
        // 3. getPhase1RemindedUserIds
        selectMocks.push(
          jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockResolvedValue(
                  phase1Reminded.map((uid) => ({ userId: uid })),
                ),
            }),
          }),
        );

        if (phase1Reminded.length > 0) {
          // 4. Batch-fetch discord IDs for all reminded users
          selectMocks.push(
            jest.fn().mockReturnValue(
              makeSelectFromWhere(
                phase1Reminded.map((uid) => ({
                  id: uid,
                  discordId: userDiscordId,
                })),
              ),
            ),
          );

          // 5. Batch-fetch all voice sessions for this event
          selectMocks.push(
            jest.fn().mockReturnValue(
              makeSelectFromWhere(
                userDiscordId && dbVoiceDuration !== null
                  ? [
                      {
                        discordUserId: userDiscordId,
                        totalDurationSec: dbVoiceDuration,
                      },
                    ]
                  : [],
              ),
            ),
          );

          // User is absent if: no discordId (can't verify), or has discordId but not in voice and below threshold
          const isAbsent =
            userDiscordId === null ||
            (!voiceActiveForUser &&
              (dbVoiceDuration === null || dbVoiceDuration < 120));

          if (isAbsent) {
            // 6. user display name lookup
            selectMocks.push(
              jest
                .fn()
                .mockReturnValue(
                  makeSelectFromWhereLimit([
                    { username: displayName, displayName },
                  ]),
                ),
            );

            // 7. roster assignment lookup (with innerJoin + limit)
            selectMocks.push(
              jest.fn().mockReturnValue({
                from: jest.fn().mockReturnValue({
                  innerJoin: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                      limit: jest
                        .fn()
                        .mockResolvedValue(role ? [{ role }] : []),
                    }),
                  }),
                }),
              }),
            );
          }
        }
      }

      // Phase 1 flows (also runs because msSinceStart >= PHASE1_OFFSET_MS)
      // signups query
      selectMocks.push(
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]), // no additional absent players
          }),
        }),
      );

      let callIdx = 0;
      mockDb.select.mockImplementation(() => {
        const mock = selectMocks[callIdx++];
        if (!mock) {
          // Default fallback for unexpected extra calls
          return {
            from: jest
              .fn()
              .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
          };
        }
        return mock() as unknown;
      });

      return event;
    };

    it('should send batched creator DM when one player is still absent after Phase 1', async () => {
      setupPhase2Flow();

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await service.checkNoShows();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1, // creatorId
          type: 'missed_event_nudge',
          title: 'No-show Alert',
          payload: expect.objectContaining({
            eventId: 42,
            absentPlayers: expect.arrayContaining([
              expect.objectContaining({
                userId: 10,
                displayName: 'PlayerOne',
                role: 'Tank',
              }),
            ]) as unknown[],
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should not send Phase 2 notification when escalation already sent (dedup)', async () => {
      setupPhase2Flow({ alreadyEscalated: true });

      await service.checkNoShows();

      // No missed_event_nudge should be sent
      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCalls).toHaveLength(0);
    });

    it('should not send Phase 2 notification when no players were reminded in Phase 1', async () => {
      setupPhase2Flow({ phase1Reminded: [] });

      await service.checkNoShows();

      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCalls).toHaveLength(0);
    });

    it('should not send Phase 2 notification when all Phase 1 reminded players are now present in voice', async () => {
      setupPhase2Flow({ voiceActiveForUser: true });
      mockVoiceAttendance.isUserActive.mockReturnValue(true);

      await service.checkNoShows();

      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCalls).toHaveLength(0);
    });

    it('should not send Phase 2 notification when all Phase 1 reminded players have sufficient voice sessions', async () => {
      // Player has 150s voice session — above 120s threshold
      setupPhase2Flow({ dbVoiceDuration: 150 });
      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      await service.checkNoShows();

      const nudgeCalls = mockNotificationService.create.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCalls).toHaveLength(0);
    });

    it('should include role in Phase 2 creator message', async () => {
      setupPhase2Flow({ role: 'Healer' });

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
      expect(nudgeCall).toBeDefined();
      const callArg = nudgeCall![0] as {
        message: string;
        payload: { absentPlayers: Array<{ role: string | null }> };
      };
      expect(callArg.message).toContain('Healer');
      expect(callArg.payload.absentPlayers[0].role).toBe('Healer');
    });

    it('should handle null role gracefully in Phase 2 message', async () => {
      setupPhase2Flow({ role: null });

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
      expect(nudgeCall).toBeDefined();
      const callArg = nudgeCall![0] as {
        payload: { absentPlayers: Array<{ role: string | null }> };
      };
      expect(callArg.payload.absentPlayers[0].role).toBeNull();
    });

    it('should use singular message format for single absent player', async () => {
      setupPhase2Flow({
        phase1Reminded: [10],
        displayName: 'PlayerOne',
        role: 'Tank',
      });

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
      expect(nudgeCall).toBeDefined();
      const callArg = nudgeCall![0] as { message: string };
      // Singular format: "<name> hasn't shown up..."
      expect(callArg.message).toMatch(/PlayerOne hasn't shown up/);
      expect(callArg.message).not.toMatch(/players haven't shown up/);
    });

    it('should send Phase 2 to creator even if creator is the absent player', async () => {
      // Creator ID = 1, also a signup that was reminded
      const event = makeEvent({
        startTime: new Date(Date.now() - 16 * 60 * 1000),
        creatorId: 1,
      });

      // Build fresh mocks for this test
      const selectCalls: jest.Mock[] = [
        // findLiveEventsInNoShowWindow
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                id: event.id,
                title: event.title,
                creatorId: 1,
                duration: [event.startTime, event.endTime],
              },
            ]),
          }),
        }),
        // hasReminderBeenSent (escalation) — not sent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
        // getPhase1RemindedUserIds — creator user 1 was reminded
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ userId: 1 }]),
          }),
        }),
        // Batch-fetch discord IDs for reminded users
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhere([{ id: 1, discordId: 'discord-creator' }]),
          ),
        // Batch-fetch voice sessions — no session
        jest.fn().mockReturnValue(makeSelectFromWhere([])),
        // getPlayerDisplayInfo: user
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([
              { username: 'CreatorUser', displayName: 'CreatorUser' },
            ]),
          ),
        // getPlayerDisplayInfo: roster assignment
        jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        // Phase 1 signups query (no absent players)
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

      const nudgeCall = mockNotificationService.create.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === 'missed_event_nudge',
      );
      expect(nudgeCall).toBeDefined();
      // Creator (userId: 1) should still receive the notification
      expect((nudgeCall![0] as { userId: number }).userId).toBe(1);
    });

    it('should insert dedup record for Phase 2 escalation before sending notification', async () => {
      setupPhase2Flow();

      const returningMock = jest.fn().mockResolvedValue([{ id: 5 }]);
      const onConflictMock = jest
        .fn()
        .mockReturnValue({ returning: returningMock });
      const valuesMock = jest
        .fn()
        .mockReturnValue({ onConflictDoNothing: onConflictMock });
      mockDb.insert.mockReturnValue({ values: valuesMock });

      await service.checkNoShows();

      // Should have inserted a noshow_escalation dedup record
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  // ─── Phase sequencing ────────────────────────────────────────────────────
});
