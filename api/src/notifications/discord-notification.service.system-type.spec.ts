/**
 * Adversarial tests for DiscordNotificationService — ROK-373
 * Focuses on:
 * - `system` notification type used in autoDisableDiscord (was `slot_vacated` before)
 * - Failure TTL comment fix (fixed 24h window, not rolling) — behavioral verification
 * - TTL set only on first failure (count === 1)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DiscordNotificationService } from './discord-notification.service';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { DISCORD_NOTIFICATION_QUEUE } from './discord-notification.constants';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

describe('DiscordNotificationService — system type & failure TTL (ROK-373)', () => {
  let service: DiscordNotificationService;

  let mockDb: MockDb;

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  const mockClientService = {
    isConnected: jest.fn().mockReturnValue(true),
    sendEmbedDM: jest.fn().mockResolvedValue(undefined),
  };

  const mockEmbedService = {
    buildWelcomeEmbed: jest.fn().mockResolvedValue({
      embed: { toJSON: () => ({}) },
      row: { toJSON: () => ({}) },
    }),
    buildUnreachableNotificationMessage: jest.fn().mockReturnValue({
      title: 'Discord DMs Unreachable',
      message: 'We could not reach you on Discord.',
    }),
  };

  const mockSettingsService = {
    getBranding: jest.fn().mockResolvedValue({
      communityName: 'Test Community',
      communityAccentColor: '#38bdf8',
    }),
  };

  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockDb = createDrizzleMock();
    mockDb.limit.mockResolvedValue([]);
    mockDb.returning.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordNotificationService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: getQueueToken(DISCORD_NOTIFICATION_QUEUE),
          useValue: mockQueue,
        },
        { provide: DiscordBotClientService, useValue: mockClientService },
        {
          provide: DiscordNotificationEmbedService,
          useValue: mockEmbedService,
        },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<DiscordNotificationService>(
      DiscordNotificationService,
    );
  });

  // ============================================================
  // autoDisableDiscord uses `system` type (not `slot_vacated`)
  // ============================================================

  describe('autoDisableDiscord — uses system notification type', () => {
    it('should insert a notification with type "system" when auto-disabling', async () => {
      mockRedis.incr.mockResolvedValue(3); // Triggers auto-disable (MAX_CONSECUTIVE_FAILURES = 3)
      mockDb.limit.mockResolvedValueOnce([
        {
          channelPrefs: {
            event_reminder: { inApp: true, push: true, discord: true },
          },
        },
      ]);

      await service.recordFailure(1);

      // The insert call inserts into the notifications table
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system',
        }),
      );
    });

    it('should NOT insert a notification with type "slot_vacated" for auto-disable', async () => {
      mockRedis.incr.mockResolvedValue(3);
      mockDb.limit.mockResolvedValueOnce([
        {
          channelPrefs: {
            event_reminder: { inApp: true, push: true, discord: true },
          },
        },
      ]);

      await service.recordFailure(1);

      // Ensure slot_vacated is not used for this system notification
      const valuesCallArgs = mockDb.values.mock.calls as Array<
        [Record<string, unknown>]
      >;
      const insertedType = valuesCallArgs[0]?.[0]?.type;
      expect(insertedType).not.toBe('slot_vacated');
    });

    it('should use title and message from buildUnreachableNotificationMessage', async () => {
      mockRedis.incr.mockResolvedValue(3);
      mockDb.limit.mockResolvedValueOnce([
        {
          channelPrefs: {
            new_event: { inApp: true, push: false, discord: true },
          },
        },
      ]);

      await service.recordFailure(42);

      expect(
        mockEmbedService.buildUnreachableNotificationMessage,
      ).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Discord DMs Unreachable',
          message: 'We could not reach you on Discord.',
        }),
      );
    });

    it('should set correct userId on the inserted system notification', async () => {
      const userId = 99;
      mockRedis.incr.mockResolvedValue(3);
      mockDb.limit.mockResolvedValueOnce([
        {
          channelPrefs: {
            slot_vacated: { inApp: true, push: true, discord: true },
          },
        },
      ]);

      await service.recordFailure(userId);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
        }),
      );
    });

    it('should still disable Discord and insert system notification even when user has no existing prefs', async () => {
      // No prefs row found — skips update but still inserts system notification
      mockRedis.incr.mockResolvedValue(3);
      mockDb.limit.mockResolvedValueOnce([]); // No prefs

      await service.recordFailure(5);

      // Should insert the system notification even when no prefs to update
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system',
          userId: 5,
        }),
      );
    });
  });

  // ============================================================
  // Failure TTL: only set on first failure (count === 1)
  // Fixed 24-hour window, NOT rolling
  // ============================================================

  describe('recordFailure — TTL only set on first failure', () => {
    it('should set expire (86400s) only when incr returns 1 (first failure)', async () => {
      mockRedis.incr.mockResolvedValue(1); // First failure

      await service.recordFailure(1);

      expect(mockRedis.expire).toHaveBeenCalledWith(
        'discord-notif:failures:1',
        86400,
      );
      expect(mockRedis.expire).toHaveBeenCalledTimes(1);
    });

    it('should NOT set expire when incr returns 2 (second failure)', async () => {
      mockRedis.incr.mockResolvedValue(2); // Second failure — TTL already set

      await service.recordFailure(1);

      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('should NOT set expire when incr returns 3 and auto-disable triggers', async () => {
      mockRedis.incr.mockResolvedValue(3); // Third failure — triggers auto-disable
      mockDb.limit.mockResolvedValueOnce([]); // No prefs

      await service.recordFailure(1);

      // expire should NOT be called — only set on first failure
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('should set 86400 second TTL (24-hour fixed window, not rolling)', async () => {
      mockRedis.incr.mockResolvedValue(1);

      await service.recordFailure(7);

      // 86400 seconds = 24 hours (fixed window, not rolling)
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'discord-notif:failures:7',
        86400,
      );
    });
  });

  // ============================================================
  // autoDisableDiscord — disables discord for all notification types
  // ============================================================

  describe('autoDisableDiscord — disables all types', () => {
    it('should set discord: false for all notification types in channelPrefs', async () => {
      mockRedis.incr.mockResolvedValue(3);
      mockDb.limit.mockResolvedValueOnce([
        {
          channelPrefs: {
            event_reminder: { inApp: true, push: true, discord: true },
            new_event: { inApp: true, push: true, discord: true },
            slot_vacated: { inApp: true, push: true, discord: true },
          },
        },
      ]);

      await service.recordFailure(10);

      expect(mockDb.update).toHaveBeenCalled();
      const setCallArgs = mockDb.set.mock.calls as Array<
        [{ channelPrefs: Record<string, { discord?: boolean }> }]
      >;
      const updatedPrefs = setCallArgs[0]?.[0]?.channelPrefs;

      if (updatedPrefs) {
        for (const type of Object.keys(updatedPrefs)) {
          expect(updatedPrefs[type]?.discord).toBe(false);
        }
      }
    });

    it('should delete failure key in Redis after auto-disable', async () => {
      mockRedis.incr.mockResolvedValue(3);
      mockDb.limit.mockResolvedValueOnce([]);

      await service.recordFailure(11);

      expect(mockRedis.del).toHaveBeenCalledWith('discord-notif:failures:11');
    });
  });

  // ============================================================
  // dispatch — `system` type passes through preferences check correctly
  // ============================================================

  describe('dispatch — system notification type handling', () => {
    it('should skip system notification if discord is explicitly disabled for system type', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ discordId: 'discord-123' }])
        .mockResolvedValueOnce([
          {
            channelPrefs: {
              system: { inApp: true, push: false, discord: false },
            },
          },
        ]);
      mockClientService.isConnected.mockReturnValue(true);

      const result = await service.dispatch({
        notificationId: 'notif-sys-1',
        userId: 1,
        type: 'system',
        title: 'System Notification',
        message: 'Test',
      });

      expect(result).toBe(false);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should enqueue system notification when discord is enabled for system type', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ discordId: 'discord-123' }])
        .mockResolvedValueOnce([
          {
            channelPrefs: {
              system: { inApp: true, push: false, discord: true },
            },
          },
        ]);
      mockClientService.isConnected.mockReturnValue(true);
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await service.dispatch({
        notificationId: 'notif-sys-2',
        userId: 1,
        type: 'system',
        title: 'System Alert',
        message: 'Test system message',
      });

      expect(result).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-dm',
        expect.objectContaining({ type: 'system' }),
        expect.anything(),
      );
    });

    it('should enqueue system notification when no prefs row exists (defaults apply)', async () => {
      // No prefs row → dispatch skips type check → proceeds to bot check
      mockDb.limit
        .mockResolvedValueOnce([{ discordId: 'discord-456' }])
        .mockResolvedValueOnce([]); // No prefs
      mockClientService.isConnected.mockReturnValue(true);
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await service.dispatch({
        notificationId: 'notif-sys-3',
        userId: 2,
        type: 'system',
        title: 'No Prefs System',
        message: 'No prefs test',
      });

      expect(result).toBe(true);
    });
  });
});
