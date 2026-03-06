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

describe('LiveNoShowService — phase1', () => {
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

});
