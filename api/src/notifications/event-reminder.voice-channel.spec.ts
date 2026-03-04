/**
 * Tests that EventReminderService correctly passes voiceChannelId in reminder payloads (ROK-507).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventReminderService } from './event-reminder.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import { RoleGapAlertService } from './role-gap-alert.service';

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
        {
          provide: RoleGapAlertService,
          useValue: { checkRoleGaps: jest.fn().mockResolvedValue(undefined) },
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

    // ROK-658: voiceChannelId and discordUrl are now pre-resolved per-event
    // and passed into sendReminder as input fields (hoisted from per-user loop).

    it('includes voiceChannelId in payload when passed as input', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));

      await service.sendReminder({
        ...baseReminder,
        voiceChannelId: '777888999',
      });

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            voiceChannelId: '777888999',
          }),
        }),
      );
    });

    it('omits voiceChannelId from payload when input is null', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));

      await service.sendReminder({
        ...baseReminder,
        voiceChannelId: null,
      });

      const createCall = mockNotificationService.create.mock.calls[0][0];
      expect(createCall.payload).not.toHaveProperty('voiceChannelId');
    });

    it('omits voiceChannelId from payload when input is undefined', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));

      await service.sendReminder(baseReminder);

      const createCall = mockNotificationService.create.mock.calls[0][0];
      expect(createCall.payload).not.toHaveProperty('voiceChannelId');
    });

    it('does not call resolveVoiceChannelId when reminder is a duplicate (returns false)', async () => {
      // Conflict → no row returned → duplicate
      mockDb.insert.mockReturnValue(makeInsertChain([]));

      const result = await service.sendReminder({
        ...baseReminder,
        voiceChannelId: '777888999',
      });

      expect(result).toBe(false);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('returns true and sends notification when not a duplicate with voice channel', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));

      const result = await service.sendReminder({
        ...baseReminder,
        voiceChannelId: '123456789',
      });

      expect(result).toBe(true);
      expect(mockNotificationService.create).toHaveBeenCalled();
    });

    it('payload contains eventId, reminderWindow, and voiceChannelId together', async () => {
      mockDb.insert.mockReturnValue(makeInsertChain([trackingRow]));

      await service.sendReminder({
        ...baseReminder,
        voiceChannelId: 'vc-456',
      });

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
