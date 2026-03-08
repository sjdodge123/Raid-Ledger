import { Test, TestingModule } from '@nestjs/testing';
import { LiveNoShowService } from './live-noshow.service';
import { NotificationService } from './notification.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';

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

  // --- checkNoShows (cron entry point) ---

  describe('checkNoShows', () => {
    it('should wrap execution in cronJobService.executeWithTracking', async () => {
      // No live events
      mockDb.select.mockReturnValue(makeSelectFromWhere([]));

      await service.checkNoShows();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'LiveNoShowService_checkNoShows',
        expect.any(Function),
      );
    });

    it('should do nothing when voiceAttendance is not available', async () => {
      const module = await Test.createTestingModule({
        providers: [
          LiveNoShowService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: NotificationService, useValue: mockNotificationService },
          { provide: CronJobService, useValue: mockCronJobService },
        ],
      }).compile();
      const serviceWithoutVoice =
        module.get<LiveNoShowService>(LiveNoShowService);

      await serviceWithoutVoice.checkNoShows();

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should do nothing when there are no live events in the window', async () => {
      mockDb.select.mockReturnValue(makeSelectFromWhere([]));

      await service.checkNoShows();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // --- Phase 1: no-show reminders ---

  describe('Phase 1 (no-show reminder at +5 min)', () => {
    it('should send reminder DM to absent signed-up player', async () => {
      const event = makeEvent({
        startTime: new Date(Date.now() - 11 * 60 * 1000),
      });

      mockDb.select
        // findLiveEventsInNoShowWindow
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: event.id,
              title: event.title,
              creatorId: event.creatorId,
              duration: [event.startTime, event.endTime],
            },
          ]),
        )
        // fetchNonBenchSignups
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              userId: 10,
              discordUserId: 'discord-10',
              discordUsername: 'PlayerOne',
            },
          ]),
        )
        // batchFetchVoiceSessions (no sessions — absent)
        .mockReturnValueOnce(makeSelectFromWhere([]));

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

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
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: event.id,
              title: event.title,
              creatorId: event.creatorId,
              duration: [event.startTime, event.endTime],
            },
          ]),
        )
        // fetchNonBenchSignups: anonymous signup with discordUserId
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              userId: null,
              discordUserId: 'discord-anon',
              discordUsername: 'AnonUser',
            },
          ]),
        )
        // batchFetchVoiceSessions
        .mockReturnValueOnce(makeSelectFromWhere([]));

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      await service.checkNoShows();

      // Anonymous signup has no userId, so sendPhase1Reminder skips
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should skip player with no discordUserId in signup', async () => {
      const event = makeEvent({
        startTime: new Date(Date.now() - 11 * 60 * 1000),
      });

      mockDb.select
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: event.id,
              title: event.title,
              creatorId: event.creatorId,
              duration: [event.startTime, event.endTime],
            },
          ]),
        )
        // fetchNonBenchSignups: no discordUserId
        .mockReturnValueOnce(
          makeSelectFromWhere([
            { userId: 10, discordUserId: null, discordUsername: null },
          ]),
        )
        // batchResolveDiscordIds: user has no discordId
        .mockReturnValueOnce(makeSelectFromWhere([{ id: 10, discordId: null }]))
        // batchFetchVoiceSessions
        .mockReturnValueOnce(makeSelectFromWhere([]));

      await service.checkNoShows();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should not send Phase 1 reminder when player is currently active in voice', async () => {
      const event = makeEvent({
        startTime: new Date(Date.now() - 11 * 60 * 1000),
      });

      mockDb.select
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: event.id,
              title: event.title,
              creatorId: event.creatorId,
              duration: [event.startTime, event.endTime],
            },
          ]),
        )
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              userId: 10,
              discordUserId: 'discord-10',
              discordUsername: 'PlayerOne',
            },
          ]),
        )
        // batchFetchVoiceSessions
        .mockReturnValueOnce(makeSelectFromWhere([]));

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
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: event.id,
              title: event.title,
              creatorId: event.creatorId,
              duration: [event.startTime, event.endTime],
            },
          ]),
        )
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              userId: 10,
              discordUserId: 'discord-10',
              discordUsername: 'PlayerOne',
            },
          ]),
        )
        // batchFetchVoiceSessions: 120 seconds (at threshold)
        .mockReturnValueOnce(
          makeSelectFromWhere([
            { discordUserId: 'discord-10', totalDurationSec: 120 },
          ]),
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
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: event.id,
              title: event.title,
              creatorId: event.creatorId,
              duration: [event.startTime, event.endTime],
            },
          ]),
        )
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              userId: 10,
              discordUserId: 'discord-10',
              discordUsername: 'PlayerOne',
            },
          ]),
        )
        // batchFetchVoiceSessions: only 60 seconds (below threshold)
        .mockReturnValueOnce(
          makeSelectFromWhere([
            { discordUserId: 'discord-10', totalDurationSec: 60 },
          ]),
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
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: event.id,
              title: event.title,
              creatorId: event.creatorId,
              duration: [event.startTime, event.endTime],
            },
          ]),
        )
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              userId: 10,
              discordUserId: 'discord-10',
              discordUsername: 'PlayerOne',
            },
          ]),
        )
        // batchFetchVoiceSessions
        .mockReturnValueOnce(makeSelectFromWhere([]));

      mockVoiceAttendance.isUserActive.mockReturnValue(false);

      // onConflictDoNothing returns empty -- already exists
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
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
        .mockReturnValueOnce(
          makeSelectFromWhere([
            {
              id: event.id,
              title: event.title,
              creatorId: event.creatorId,
              duration: [event.startTime, event.endTime],
            },
          ]),
        )
        .mockReturnValueOnce(
          makeSelectFromWhere([
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
        )
        // batchFetchVoiceSessions (single batch query for all)
        .mockReturnValueOnce(makeSelectFromWhere([]));

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

  // --- Phase 2: creator escalation ---
});
