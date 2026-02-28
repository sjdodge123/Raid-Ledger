/**
 * Tests that EventReminderService correctly passes voiceChannelId in reminder payloads (ROK-507).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventReminderService } from './event-reminder.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';

describe('EventReminderService — voice channel in reminder payloads (ROK-507)', () => {
  let service: EventReminderService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelId: jest.Mock;
  };

  const makeInsertChain = (resolvedRows: unknown[]) => ({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue(resolvedRows),
      }),
    }),
  });

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
            getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
          },
        },
      ],
    }).compile();

    service = module.get<EventReminderService>(EventReminderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendReminder — voice channel in notification payload', () => {
    const baseReminder = {
      eventId: 10,
      userId: 1,
      windowType: '15min' as const,
      windowLabel: '15 Minutes',
      title: 'Raid Night',
      startTime: new Date(Date.now() + 15 * 60 * 1000),
      minutesUntil: 15,
      characterDisplay: 'Thrall (Shaman)',
      gameId: 5,
    };

    const trackingRow = {
      id: 1,
      eventId: 10,
      userId: 1,
      reminderType: '15min',
      sentAt: new Date(),
    };

    it('includes voiceChannelId in payload when channelResolver returns one', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));
      mockNotificationService.resolveVoiceChannelId.mockResolvedValue(
        '777888999',
      );

      await service.sendReminder(baseReminder);

      expect(
        mockNotificationService.resolveVoiceChannelId,
      ).toHaveBeenCalledWith(5);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            voiceChannelId: '777888999',
          }),
        }),
      );
    });

    it('omits voiceChannelId from payload when channelResolver returns null', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));
      mockNotificationService.resolveVoiceChannelId.mockResolvedValue(null);

      await service.sendReminder(baseReminder);

      const createCall = mockNotificationService.create.mock.calls[0][0];
      expect(createCall.payload).not.toHaveProperty('voiceChannelId');
    });

    it('calls resolveVoiceChannelId with the gameId from the reminder', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));
      mockNotificationService.resolveVoiceChannelId.mockResolvedValue(null);

      await service.sendReminder({ ...baseReminder, gameId: 99 });

      expect(
        mockNotificationService.resolveVoiceChannelId,
      ).toHaveBeenCalledWith(99);
    });

    it('calls resolveVoiceChannelId with undefined when gameId is not provided', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));
      mockNotificationService.resolveVoiceChannelId.mockResolvedValue(null);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { gameId: _omit, ...reminderWithoutGame } = baseReminder;
      await service.sendReminder(reminderWithoutGame);

      expect(
        mockNotificationService.resolveVoiceChannelId,
      ).toHaveBeenCalledWith(undefined);
    });

    it('does not call resolveVoiceChannelId when reminder is a duplicate (returns false)', async () => {
      // Conflict → no row returned → duplicate
      mockDb.insert.mockReturnValue(makeInsertChain([]));

      const result = await service.sendReminder(baseReminder);

      expect(result).toBe(false);
      expect(
        mockNotificationService.resolveVoiceChannelId,
      ).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('returns true and sends notification when not a duplicate with voice channel', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));
      mockNotificationService.resolveVoiceChannelId.mockResolvedValue(
        '123456789',
      );

      const result = await service.sendReminder(baseReminder);

      expect(result).toBe(true);
      expect(mockNotificationService.create).toHaveBeenCalled();
    });

    it('payload contains eventId, reminderWindow, and voiceChannelId together', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));
      mockNotificationService.resolveVoiceChannelId.mockResolvedValue('vc-456');

      await service.sendReminder(baseReminder);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event_reminder',
          payload: expect.objectContaining({
            eventId: 10,
            reminderWindow: '15min',
            voiceChannelId: 'vc-456',
          }),
        }),
      );
    });
  });
});
