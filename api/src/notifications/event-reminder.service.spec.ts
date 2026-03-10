import { Test, TestingModule } from '@nestjs/testing';
import { EventReminderService } from './event-reminder.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import { RoleGapAlertService } from './role-gap-alert.service';

describe('EventReminderService', () => {
  let service: EventReminderService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  let mockRoleGapAlertService: { checkRoleGaps: jest.Mock };

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
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    };

    mockRoleGapAlertService = {
      checkRoleGaps: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: RoleGapAlertService,
          useValue: mockRoleGapAlertService,
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

      await service.sendReminder({
        eventId: 10,
        userId: 1,
        windowType: '24hour',
        windowLabel: '24 Hours',
        title: 'Ghost Raid',
        startTime: new Date(Date.now() + 12 * 60 * 60 * 1000),
        minutesUntil: 720,
        characterDisplay: null,
      });

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

      mockDb.select.mockReturnValueOnce(selectChain);

      await service.handleReminders();

      expect(mockDb.select).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockRoleGapAlertService.checkRoleGaps).toHaveBeenCalledTimes(1);
    });

    it('should send reminders for events in the 15min window', async () => {
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

      const usersSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 1, discordId: 'discord-1' },
            { id: 2, discordId: 'discord-2' },
          ]),
        }),
      };

      const charsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      const tzSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockResolvedValue([{ userId: 1, value: 'America/New_York' }]),
        }),
      };

      mockDb.select
        .mockReturnValueOnce(eventsSelectChain)
        .mockReturnValueOnce(signupsSelectChain)
        .mockReturnValueOnce(usersSelectChain)
        .mockReturnValueOnce(tzSelectChain)
        .mockReturnValueOnce(charsSelectChain);

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

      const tzSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      mockDb.select
        .mockReturnValueOnce(eventsSelectChain)
        .mockReturnValueOnce(signupsSelectChain)
        .mockReturnValueOnce(usersSelectChain)
        .mockReturnValueOnce(tzSelectChain)
        .mockReturnValueOnce(charsSelectChain);

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

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 2 }),
      );
    });

    it('should delegate role gap checking to RoleGapAlertService', async () => {
      const eventsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };

      mockDb.select.mockReturnValueOnce(eventsSelectChain);

      await service.handleReminders();

      expect(mockRoleGapAlertService.checkRoleGaps).toHaveBeenCalledWith(
        expect.any(Date),
        'America/New_York',
      );
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
              reminder15min: false,
              reminder1hour: false,
              reminder24hour: false,
              cancelledAt: null,
            },
          ]),
        }),
      };

      mockDb.select.mockReturnValueOnce(eventsSelectChain);

      await service.handleReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });
});
