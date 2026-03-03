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

describe('LiveNoShowService', () => {
  let service: LiveNoShowService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: { create: jest.Mock };
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

  describe('checkNoShows', () => {
    it('should wrap execution in cronJobService.executeWithTracking', async () => {
      // No live events — minimal DB mock to avoid errors
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.checkNoShows();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'LiveNoShowService_checkNoShows',
        expect.any(Function),
      );
    });

    it('should do nothing when voiceAttendance is not available', async () => {
      // Re-create service without VoiceAttendanceService
      const module = await Test.createTestingModule({
        providers: [
          LiveNoShowService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: NotificationService, useValue: mockNotificationService },
          { provide: CronJobService, useValue: mockCronJobService },
          // No VoiceAttendanceService provided — @Optional() means it's null
        ],
      }).compile();
      const serviceWithoutVoice =
        module.get<LiveNoShowService>(LiveNoShowService);

      await serviceWithoutVoice.checkNoShows();

      // No DB queries should have been made
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should do nothing when there are no live events in the window', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]), // no live events
        }),
      });

      await service.checkNoShows();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // ─── Phase 1: no-show reminders ──────────────────────────────────────────

  describe('Phase 1 (no-show reminder at +5 min)', () => {
    it('should send reminder DM to absent signed-up player', async () => {
      const event = makeEvent({
        startTime: new Date(Date.now() - 11 * 60 * 1000),
      });

      // findLiveEventsInNoShowWindow
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
        // getAbsentSignedUpPlayers: signups query
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                userId: 10,
                discordUserId: 'discord-10',
                discordUsername: 'PlayerOne',
              },
            ]),
          }),
        })
        // getAbsentSignedUpPlayers: voice session query (.limit)
        .mockReturnValueOnce(makeSelectFromWhereLimit([]));
      // insertReminderDedup: hasReminderBeenSent (.limit) — not yet sent
      // (handled by insert mock below)

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]), // inserted = true
          }),
        }),
      });

      // isUserActive returns false (absent)
      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      await service.checkNoShows();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 10,
          type: 'event_reminder',
          title: 'Are you joining?',
          payload: expect.objectContaining({
            eventId: event.id,
            noshowReminder: true,
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should skip player with no userId (anonymous signup)', async () => {
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
            where: jest.fn().mockResolvedValue([
              // userId is null — anonymous Discord signup
              {
                userId: null,
                discordUserId: 'discord-anon',
                discordUsername: 'AnonUser',
              },
            ]),
          }),
        })
        .mockReturnValueOnce(makeSelectFromWhereLimit([])); // voice session check

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      await service.checkNoShows();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should skip player with no discordUserId in signup', async () => {
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
            where: jest.fn().mockResolvedValue([
              // No discordUserId — can't check voice
              { userId: 10, discordUserId: null, discordUsername: null },
            ]),
          }),
        })
        // Fallback user lookup — user also has no discordId
        .mockReturnValueOnce(makeSelectFromWhereLimit([{ discordId: null }]));

      await service.checkNoShows();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should not send Phase 1 reminder when player is currently active in voice', async () => {
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
            where: jest.fn().mockResolvedValue([
              {
                userId: 10,
                discordUserId: 'discord-10',
                discordUsername: 'PlayerOne',
              },
            ]),
          }),
        });

      // Player IS active in voice
      mockVoiceAttendance.isUserActive.mockReturnValue(true);

      await service.checkNoShows();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should not send Phase 1 reminder when player has sufficient voice session duration (>= 120s)', async () => {
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
            where: jest.fn().mockResolvedValue([
              {
                userId: 10,
                discordUserId: 'discord-10',
                discordUsername: 'PlayerOne',
              },
            ]),
          }),
        })
        // Voice session with 120 seconds total (at threshold)
        .mockReturnValueOnce(
          makeSelectFromWhereLimit([{ totalDurationSec: 120 }]),
        );

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      await service.checkNoShows();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should send Phase 1 reminder when player had brief voice session (< 120s threshold)', async () => {
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
            where: jest.fn().mockResolvedValue([
              {
                userId: 10,
                discordUserId: 'discord-10',
                discordUsername: 'PlayerOne',
              },
            ]),
          }),
        })
        // Only 60 seconds — brief join/leave, below threshold
        .mockReturnValueOnce(
          makeSelectFromWhereLimit([{ totalDurationSec: 60 }]),
        );

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

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
          userId: 10,
          type: 'event_reminder',
          payload: expect.objectContaining({ noshowReminder: true }) as Record<
            string,
            unknown
          >,
        }),
      );
    });

    it('should not send duplicate Phase 1 reminder when dedup record already exists', async () => {
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
            where: jest.fn().mockResolvedValue([
              {
                userId: 10,
                discordUserId: 'discord-10',
                discordUsername: 'PlayerOne',
              },
            ]),
          }),
        })
        .mockReturnValueOnce(makeSelectFromWhereLimit([]));

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      // onConflictDoNothing returns empty — already exists
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]), // empty = already sent
          }),
        }),
      });

      await service.checkNoShows();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should send Phase 1 reminders to multiple absent players', async () => {
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
            where: jest.fn().mockResolvedValue([
              {
                userId: 10,
                discordUserId: 'discord-10',
                discordUsername: 'PlayerOne',
              },
              {
                userId: 11,
                discordUserId: 'discord-11',
                discordUsername: 'PlayerTwo',
              },
            ]),
          }),
        })
        // Voice session queries for each player
        .mockReturnValueOnce(makeSelectFromWhereLimit([]))
        .mockReturnValueOnce(makeSelectFromWhereLimit([]));

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await service.checkNoShows();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 10, type: 'event_reminder' }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 11, type: 'event_reminder' }),
      );
    });
  });

  // ─── Phase 2: creator escalation ─────────────────────────────────────────

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
          // 4. checkVoicePresence: user lookup (.limit)
          selectMocks.push(
            jest
              .fn()
              .mockReturnValue(
                makeSelectFromWhereLimit(
                  userDiscordId !== null ? [{ discordId: userDiscordId }] : [],
                ),
              ),
          );

          if (userDiscordId && !voiceActiveForUser) {
            // 5. checkVoicePresence: voice session lookup (.limit)
            selectMocks.push(
              jest
                .fn()
                .mockReturnValue(
                  makeSelectFromWhereLimit(
                    dbVoiceDuration !== null
                      ? [{ totalDurationSec: dbVoiceDuration }]
                      : [],
                  ),
                ),
            );

            // If still absent, getPlayerDisplayInfo
            if (dbVoiceDuration === null || dbVoiceDuration < 120) {
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
        // checkVoicePresence: user lookup
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([{ discordId: 'discord-creator' }]),
          ),
        // checkVoicePresence: voice session — no session
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
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
        // checkVoicePresence for player 10: user lookup
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([{ discordId: 'discord-10' }]),
          ),
        // checkVoicePresence for player 10: voice session — absent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
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
        // checkVoicePresence for player 11: user lookup
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([{ discordId: 'discord-11' }]),
          ),
        // checkVoicePresence for player 11: voice session — absent
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
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
        jest
          .fn()
          .mockReturnValue(
            makeSelectFromWhereLimit([{ discordId: 'discord-10' }]),
          ),
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
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
            makeSelectFromWhereLimit([{ discordId: 'discord-11' }]),
          ),
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
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
        // checkVoicePresence: user has null discordId → returns false (absent)
        jest
          .fn()
          .mockReturnValue(makeSelectFromWhereLimit([{ discordId: null }])),
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
      // When user record is not found, checkVoicePresence returns false (treated as absent).
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
        // checkVoicePresence: user not found in users table → returns false (absent)
        jest.fn().mockReturnValue(makeSelectFromWhereLimit([])),
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
