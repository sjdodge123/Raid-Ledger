import { Test, TestingModule } from '@nestjs/testing';
import { EventReminderService } from './event-reminder.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';

describe('EventReminderService', () => {
  let service: EventReminderService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelId: jest.Mock;
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
    };

    mockNotificationService = {
      create: jest.fn().mockResolvedValue({
        id: 'notif-1',
        userId: 1,
        type: 'event_reminder',
        title: 'Test',
        message: 'Test message',
        createdAt: new Date().toISOString(),
      }),
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
      resolveVoiceChannelId: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventReminderService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
        {
          provide: CronJobService,
          useValue: {
            executeWithTracking: jest.fn(
              (_name: string, fn: () => Promise<void>) => fn(),
            ),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
            getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
          },
        },
      ],
    }).compile();

    service = module.get<EventReminderService>(EventReminderService);
  });

  describe('sendReminder', () => {
    it('should insert tracking row and create notification', async () => {
      const trackingRow = {
        id: 1,
        eventId: 10,
        userId: 1,
        reminderType: '15min',
        sentAt: new Date(),
      };

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([trackingRow]),
          }),
        }),
      });

      const result = await service.sendReminder({
        eventId: 10,
        userId: 1,
        windowType: '15min',
        windowLabel: '15 Minutes',
        title: 'Raid Night',
        startTime: new Date(Date.now() + 15 * 60 * 1000),
        minutesUntil: 15,
        characterDisplay: 'Thrall (Shaman)',
      });

      expect(result).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          type: 'event_reminder',
          title: 'Event Starting in 15 Minutes!',
          payload: expect.objectContaining({
            eventId: 10,
            reminderWindow: '15min',
            characterDisplay: 'Thrall (Shaman)',
            startTime: expect.any(String) as string,
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should use dynamic title from minutesUntil, not static windowLabel (ROK-647)', async () => {
      const trackingRow = {
        id: 1,
        eventId: 10,
        userId: 1,
        reminderType: '24hour',
        sentAt: new Date(),
      };

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([trackingRow]),
          }),
        }),
      });

      // Simulate the old bug: windowLabel says "24 Hours" but actual time is 12 hours
      await service.sendReminder({
        eventId: 10,
        userId: 1,
        windowType: '24hour',
        windowLabel: '24 Hours',
        title: 'Ghost Raid',
        startTime: new Date(Date.now() + 12 * 60 * 60 * 1000),
        minutesUntil: 720, // 12 hours in minutes
        characterDisplay: null,
      });

      // Title should say "12 Hours", NOT "24 Hours"
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Event Starting in 12 Hours!',
        }),
      );
    });

    it('should skip notification when reminder already sent (duplicate)', async () => {
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.sendReminder({
        eventId: 10,
        userId: 1,
        windowType: '15min',
        windowLabel: '15 Minutes',
        title: 'Raid Night',
        startTime: new Date(Date.now() + 15 * 60 * 1000),
        minutesUntil: 15,
        characterDisplay: null,
      });

      expect(result).toBe(false);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  describe('getUserTimezones', () => {
    it('should return user timezones from preferences', async () => {
      const selectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: 1, value: 'America/New_York' },
            { userId: 2, value: 'Europe/London' },
          ]),
        }),
      };
      mockDb.select.mockReturnValue(selectChain);

      const result = await service.getUserTimezones();

      expect(result).toEqual([
        { userId: 1, timezone: 'America/New_York' },
        { userId: 2, timezone: 'Europe/London' },
      ]);
    });

    it('should fall back to UTC for "auto" timezone', async () => {
      const selectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ userId: 1, value: 'auto' }]),
        }),
      };
      mockDb.select.mockReturnValue(selectChain);

      const result = await service.getUserTimezones();

      expect(result).toEqual([{ userId: 1, timezone: 'UTC' }]);
    });

    it('should return empty array when no users have timezone set', async () => {
      const selectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };
      mockDb.select.mockReturnValue(selectChain);

      const result = await service.getUserTimezones();

      expect(result).toEqual([]);
    });
  });

  describe('handleReminders', () => {
    it('should exit early when no events are in any window', async () => {
      // Return events that are far in the future (not in any window)
      const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 2 * 60 * 60 * 1000);

      const selectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            {
              id: 10,
              title: 'Far Future Event',
              duration: [futureStart, futureEnd] as [Date, Date],
              gameId: null,

              reminder15min: true,
              reminder1hour: false,
              reminder24hour: false,
              cancelledAt: null,
            },
          ]),
        }),
      };
      // Role gap check: no MMO events in 4h window
      const roleGapChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      mockDb.select
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(roleGapChain);

      await service.handleReminders();

      // candidate events + role gap check queries only
      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should send reminders for events in the 15min window', async () => {
      const now = new Date();
      const soonStart = new Date(now.getTime() + 10 * 60 * 1000); // 10 min from now
      const soonEnd = new Date(soonStart.getTime() + 2 * 60 * 60 * 1000);

      // First call: candidate events query
      const eventsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            {
              id: 10,
              title: 'Raid Night',
              duration: [soonStart, soonEnd] as [Date, Date],
              gameId: null,

              reminder15min: true,
              reminder1hour: false,
              reminder24hour: false,
              cancelledAt: null,
            },
          ]),
        }),
      };

      // Second call: signups
      const signupsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { eventId: 10, userId: 1 },
            { eventId: 10, userId: 2 },
          ]),
        }),
      };

      // Third call: users
      const usersSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 1, discordId: 'discord-1' },
            { id: 2, discordId: 'discord-2' },
          ]),
        }),
      };

      // Fourth call: characters
      const charsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      // Fifth call: getUserTimezones (ROK-544)
      const tzSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockResolvedValue([{ userId: 1, value: 'America/New_York' }]),
        }),
      };

      // Sixth call: checkRoleGaps — no MMO events
      const roleGapSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      mockDb.select
        .mockReturnValueOnce(eventsSelectChain)
        .mockReturnValueOnce(signupsSelectChain)
        .mockReturnValueOnce(usersSelectChain)
        .mockReturnValueOnce(charsSelectChain)
        .mockReturnValueOnce(tzSelectChain)
        .mockReturnValueOnce(roleGapSelectChain);

      // Mock sendReminder tracking insert
      const trackingRow = {
        id: 1,
        eventId: 10,
        userId: 1,
        reminderType: '15min',
        sentAt: new Date(),
      };
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([trackingRow]),
          }),
        }),
      });

      await service.handleReminders();

      // Should have created notifications for both users
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          type: 'event_reminder',
          payload: expect.objectContaining({
            eventId: 10,
            reminderWindow: '15min',
          }) as Record<string, unknown>,
        }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 2,
          type: 'event_reminder',
          payload: expect.objectContaining({
            eventId: 10,
            reminderWindow: '15min',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should send reminders to users without discordId (ROK-489)', async () => {
      const now = new Date();
      const soonStart = new Date(now.getTime() + 10 * 60 * 1000);
      const soonEnd = new Date(soonStart.getTime() + 2 * 60 * 60 * 1000);

      const eventsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            {
              id: 10,
              title: 'Raid Night',
              duration: [soonStart, soonEnd] as [Date, Date],
              gameId: null,
              reminder15min: true,
              reminder1hour: false,
              reminder24hour: false,
              cancelledAt: null,
            },
          ]),
        }),
      };

      const signupsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { eventId: 10, userId: 1 },
            { eventId: 10, userId: 2 },
          ]),
        }),
      };

      // User 1 has Discord linked, User 2 does NOT
      const usersSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 1, discordId: 'discord-1' },
            { id: 2, discordId: null },
          ]),
        }),
      };

      const charsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      // Fifth call: getUserTimezones (ROK-544)
      const tzSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      // Sixth call: checkRoleGaps — no MMO events
      const roleGapSelectChain2 = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      mockDb.select
        .mockReturnValueOnce(eventsSelectChain)
        .mockReturnValueOnce(signupsSelectChain)
        .mockReturnValueOnce(usersSelectChain)
        .mockReturnValueOnce(charsSelectChain)
        .mockReturnValueOnce(tzSelectChain)
        .mockReturnValueOnce(roleGapSelectChain2);

      const trackingRow = {
        id: 1,
        eventId: 10,
        userId: 1,
        reminderType: '15min',
        sentAt: new Date(),
      };
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([trackingRow]),
          }),
        }),
      });

      await service.handleReminders();

      // Both users should receive notifications — including user 2 without Discord
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 2 }),
      );
    });

    it('should call checkRoleGaps after reminder windows', async () => {
      // Return no events in any reminder window
      const eventsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };
      // Role gap query: no MMO events
      const roleGapSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      mockDb.select
        .mockReturnValueOnce(eventsSelectChain) // candidateEvents
        .mockReturnValueOnce(roleGapSelectChain); // checkRoleGaps query

      await service.handleReminders();

      // 2 select calls: candidate events + role gap check
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('should not send reminders when window is disabled for event', async () => {
      const now = new Date();
      const soonStart = new Date(now.getTime() + 10 * 60 * 1000);
      const soonEnd = new Date(soonStart.getTime() + 2 * 60 * 60 * 1000);

      const eventsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            {
              id: 10,
              title: 'Raid Night',
              duration: [soonStart, soonEnd] as [Date, Date],
              gameId: null,

              // 15min reminder is disabled
              reminder15min: false,
              reminder1hour: false,
              reminder24hour: false,
              cancelledAt: null,
            },
          ]),
        }),
      };

      // Also need to mock the role gap query (called after reminder windows)
      const roleGapSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      mockDb.select
        .mockReturnValueOnce(eventsSelectChain)
        .mockReturnValueOnce(roleGapSelectChain);

      await service.handleReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  describe('checkRoleGaps (ROK-536)', () => {
    const now = new Date();

    /** Helper: mock select chain returning the given value. */
    function mockSelectChain(value: unknown[]) {
      return {
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              groupBy: jest.fn().mockResolvedValue(value),
            }),
          }),
          where: jest.fn().mockResolvedValue(value),
        }),
      };
    }

    /** Helper: mock the insert→values→onConflict→returning dedup chain. */
    function mockDedupInsert(isNew: boolean) {
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(
              isNew
                ? [
                    {
                      id: 1,
                      eventId: 10,
                      userId: 100,
                      reminderType: 'role_gap_4h',
                      sentAt: now,
                    },
                  ]
                : [],
            ),
          }),
        }),
      });
    }

    it('should send alert when MMO event is missing tanks', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      // Events query
      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Mythic Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        // Roster assignment counts (1 tank, 4 healers)
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'tank', count: 1 },
            { eventId: 10, role: 'healer', count: 4 },
          ]),
        )
        // getUserTimezones for creator
        .mockReturnValueOnce(mockSelectChain([]));

      mockDedupInsert(true);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 100,
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: expect.stringContaining('Missing 1 tank') as string,
          payload: expect.objectContaining({
            eventId: 10,
            eventTitle: 'Mythic Raid',
            gapSummary: 'Missing 1 tank',
            rosterSummary: 'Tanks: 1/2',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should send alert when missing healers', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'tank', count: 2 },
            { eventId: 10, role: 'healer', count: 2 },
          ]),
        )
        .mockReturnValueOnce(mockSelectChain([]));

      mockDedupInsert(true);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            gapSummary: 'Missing 2 healers',
            rosterSummary: 'Healers: 2/4',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should send alert when both tanks and healers are missing', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'healer', count: 3 },
            // No tank entries — 0 filled
          ]),
        )
        .mockReturnValueOnce(mockSelectChain([]));

      mockDedupInsert(true);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            gapSummary: 'Missing 2 tanks, 1 healer',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should NOT alert when roster is fully staffed', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'tank', count: 2 },
            { eventId: 10, role: 'healer', count: 4 },
          ]),
        );

      await service.checkRoleGaps(now, 'UTC');

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should NOT alert when no MMO events are in the 4h window', async () => {
      mockDb.select.mockReturnValueOnce(mockSelectChain([]));

      await service.checkRoleGaps(now, 'UTC');

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should skip duplicate alerts (dedup returns empty)', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'tank', count: 1 },
            { eventId: 10, role: 'healer', count: 4 },
          ]),
        );

      // Dedup returns empty — already sent
      mockDedupInsert(false);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should use default slot counts when slotConfig omits them', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              // slotConfig only has type, no tank/healer counts → defaults to 2/4
              slotConfig: { type: 'mmo' },
            },
          ]),
        )
        .mockReturnValueOnce(mockSelectChain([])) // No roster assignments at all
        .mockReturnValueOnce(mockSelectChain([])); // getUserTimezones

      mockDedupInsert(true);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            gapSummary: 'Missing 2 tanks, 4 healers',
          }) as Record<string, unknown>,
        }),
      );
    });
  });

  describe('sendRoleGapAlert (ROK-536)', () => {
    const now = new Date();
    const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

    it('should return true on first send and false on duplicate', async () => {
      // First call — new insert
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              {
                id: 1,
                eventId: 10,
                userId: 100,
                reminderType: 'role_gap_4h',
                sentAt: now,
              },
            ]),
          }),
        }),
      });

      // getUserTimezones
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result1 = await service.sendRoleGapAlert(
        {
          eventId: 10,
          creatorId: 100,
          title: 'Raid',
          startTime: fourHoursOut,
          gameId: 1,
          gaps: [{ role: 'tank', required: 2, filled: 1, missing: 1 }],
        },
        'UTC',
      );

      expect(result1).toBe(true);
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);

      // Second call — duplicate
      mockNotificationService.create.mockClear();
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result2 = await service.sendRoleGapAlert(
        {
          eventId: 10,
          creatorId: 100,
          title: 'Raid',
          startTime: fourHoursOut,
          gameId: 1,
          gaps: [{ role: 'tank', required: 2, filled: 1, missing: 1 }],
        },
        'UTC',
      );

      expect(result2).toBe(false);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should include suggested reason in payload', async () => {
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              {
                id: 1,
                eventId: 10,
                userId: 100,
                reminderType: 'role_gap_4h',
                sentAt: now,
              },
            ]),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.sendRoleGapAlert(
        {
          eventId: 10,
          creatorId: 100,
          title: 'Raid',
          startTime: fourHoursOut,
          gameId: 1,
          gaps: [
            { role: 'tank', required: 2, filled: 0, missing: 2 },
            { role: 'healer', required: 4, filled: 3, missing: 1 },
          ],
        },
        'UTC',
      );

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            suggestedReason:
              'Not enough tank/healer — missing 2 tanks, 1 healer',
          }) as Record<string, unknown>,
        }),
      );
    });
  });
});
