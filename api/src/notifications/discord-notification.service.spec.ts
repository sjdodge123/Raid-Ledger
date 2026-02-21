import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DiscordNotificationService } from './discord-notification.service';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { DISCORD_NOTIFICATION_QUEUE } from './discord-notification.constants';

describe('DiscordNotificationService', () => {
  let service: DiscordNotificationService;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([]),
  };

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
      message: 'Test message',
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

    // Reset chain methods
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValue([]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();

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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('dispatch', () => {
    it('should skip when user has no Discord linked', async () => {
      mockDb.limit.mockResolvedValueOnce([{ discordId: null }]);

      const result = await service.dispatch({
        notificationId: 'notif-1',
        userId: 1,
        type: 'event_reminder',
        title: 'Test',
        message: 'Test message',
      });

      expect(result).toBe(false);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should skip when Discord is disabled in preferences', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ discordId: '123456' }])
        .mockResolvedValueOnce([
          {
            channelPrefs: {
              event_reminder: { inApp: true, push: true, discord: false },
            },
          },
        ]);

      const result = await service.dispatch({
        notificationId: 'notif-1',
        userId: 1,
        type: 'event_reminder',
        title: 'Test',
        message: 'Test message',
      });

      expect(result).toBe(false);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should skip when bot is not connected', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ discordId: '123456' }])
        .mockResolvedValueOnce([]);
      mockClientService.isConnected.mockReturnValue(false);

      const result = await service.dispatch({
        notificationId: 'notif-1',
        userId: 1,
        type: 'event_reminder',
        title: 'Test',
        message: 'Test message',
      });

      expect(result).toBe(false);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should skip when rate limited', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ discordId: '123456' }])
        .mockResolvedValueOnce([]);
      mockClientService.isConnected.mockReturnValue(true);
      mockRedis.get.mockResolvedValueOnce('1');

      const result = await service.dispatch({
        notificationId: 'notif-1',
        userId: 1,
        type: 'event_reminder',
        title: 'Test',
        message: 'Test message',
      });

      expect(result).toBe(false);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should enqueue when all checks pass', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ discordId: '123456' }])
        .mockResolvedValueOnce([]);
      mockClientService.isConnected.mockReturnValue(true);
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await service.dispatch({
        notificationId: 'notif-1',
        userId: 1,
        type: 'event_reminder',
        title: 'Test',
        message: 'Test message',
      });

      expect(result).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-dm',
        expect.objectContaining({
          notificationId: 'notif-1',
          userId: 1,
          discordId: '123456',
          type: 'event_reminder',
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: expect.objectContaining({ type: 'exponential' }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });

  describe('sendWelcomeDM', () => {
    it('should skip when user has no Discord linked', async () => {
      mockDb.limit.mockResolvedValueOnce([{ discordId: null }]);

      await service.sendWelcomeDM(1);

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should skip when already sent (tracked in Redis)', async () => {
      mockDb.limit.mockResolvedValueOnce([{ discordId: '123456' }]);
      mockRedis.get.mockResolvedValueOnce('1');

      await service.sendWelcomeDM(1);

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should send welcome DM and track in Redis', async () => {
      mockDb.limit.mockResolvedValueOnce([{ discordId: '123456' }]);
      mockRedis.get.mockResolvedValueOnce(null);

      await service.sendWelcomeDM(1);

      expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
        '123456',
        expect.anything(),
        expect.anything(),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'discord-notif:welcome:1',
        '1',
      );
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count in Redis', async () => {
      mockRedis.incr.mockResolvedValue(1);

      await service.recordFailure(1);

      expect(mockRedis.incr).toHaveBeenCalledWith('discord-notif:failures:1');
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'discord-notif:failures:1',
        86400,
      );
    });

    it('should auto-disable Discord after 3 consecutive failures', async () => {
      mockRedis.incr.mockResolvedValue(3);
      mockDb.limit.mockResolvedValueOnce([
        {
          channelPrefs: {
            event_reminder: { inApp: true, push: true, discord: true },
            new_event: { inApp: true, push: false, discord: true },
          },
        },
      ]);
      mockDb.returning.mockResolvedValueOnce([]);

      await service.recordFailure(1);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('discord-notif:failures:1');
    });
  });

  describe('resetFailures', () => {
    it('should clear failure count in Redis', async () => {
      await service.resetFailures(1);

      expect(mockRedis.del).toHaveBeenCalledWith('discord-notif:failures:1');
    });
  });
});
