import { Test, TestingModule } from '@nestjs/testing';
import { EventReminderService } from './event-reminder.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('EventReminderService', () => {
  let service: EventReminderService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: { create: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventReminderService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<EventReminderService>(EventReminderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendReminder', () => {
    it('should insert tracking row and create notification', async () => {
      const trackingRow = {
        id: 1,
        eventId: 10,
        userId: 1,
        reminderType: 'starting_soon',
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
        reminderType: 'starting_soon',
        title: 'Event starting soon',
        message: 'Event starts in 30 minutes.',
      });

      expect(result).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockNotificationService.create).toHaveBeenCalledWith({
        userId: 1,
        type: 'event_reminder',
        title: 'Event starting soon',
        message: 'Event starts in 30 minutes.',
        payload: { eventId: 10 },
      });
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
        reminderType: 'starting_soon',
        title: 'Event starting soon',
        message: 'Event starts in 30 minutes.',
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

  describe('handleDayOfReminders', () => {
    it('should exit early when no users have timezone preferences', async () => {
      const selectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };
      mockDb.select.mockReturnValue(selectChain);

      await service.handleDayOfReminders();

      // Only getUserTimezones select should have been called
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  describe('handleStartingSoonReminders', () => {
    it('should exit early when no events in window', async () => {
      // No .where() — query returns all events, JS filters by time
      const selectChain = {
        from: jest.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await service.handleStartingSoonReminders();

      // Only the events query should have been called
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should send reminders for events starting soon', async () => {
      const now = new Date();
      const soonStart = new Date(now.getTime() + 25 * 60 * 1000); // 25 min from now
      const soonEnd = new Date(now.getTime() + 85 * 60 * 1000);

      // First call: find candidate events (no .where() — JS filters by time)
      const eventsSelectChain = {
        from: jest.fn().mockResolvedValue([
          {
            id: 10,
            title: 'Raid Night',
            duration: [soonStart, soonEnd] as [Date, Date],
          },
        ]),
      };

      // Second call: get signups for these events
      const signupsSelectChain = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { eventId: 10, userId: 1 },
            { eventId: 10, userId: 2 },
          ]),
        }),
      };

      mockDb.select
        .mockReturnValueOnce(eventsSelectChain)
        .mockReturnValueOnce(signupsSelectChain);

      // Mock sendReminder tracking insert
      const trackingRow = {
        id: 1,
        eventId: 10,
        userId: 1,
        reminderType: 'starting_soon',
        sentAt: new Date(),
      };
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([trackingRow]),
          }),
        }),
      });

      await service.handleStartingSoonReminders();

      // Should have created notifications for both users
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          type: 'event_reminder',
          payload: { eventId: 10 },
        }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 2,
          type: 'event_reminder',
          payload: { eventId: 10 },
        }),
      );
    });
  });
});
