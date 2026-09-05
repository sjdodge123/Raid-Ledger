/**
 * ROK-1471 D11 — pins the preference read path that actually decides whether
 * an `lfg_invite` DM goes out.
 *
 * `DiscordNotificationService` reads the STORED prefs and does NOT merge
 * `DEFAULT_CHANNEL_PREFS`, so the semantics are opt-OUT: a row written before
 * `lfg_invite` existed has no key, and a missing key SENDS. That is the
 * intended default for this type — pinned here so a future change to merge
 * defaults (which would make an opt-IN default silently dead) fails loudly.
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
import { NotificationDedupService } from './notification-dedup.service';
import { DEFAULT_CHANNEL_PREFS } from '../drizzle/schema/notification-preferences';

describe('DiscordNotificationService — lfg_invite prefs (ROK-1471)', () => {
  let service: DiscordNotificationService;
  let mockDb: MockDb;
  const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };

  /** Stored prefs row + the discord id resolve off the same mocked read. */
  function storedPrefs(channelPrefs: Record<string, unknown>): void {
    mockDb.limit.mockResolvedValue([
      { discordId: '123456789012345678', channelPrefs },
    ]);
  }

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
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            sendEmbedDM: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DiscordNotificationEmbedService,
          useValue: { buildWelcomeEmbed: jest.fn() },
        },
        {
          provide: SettingsService,
          useValue: { getBranding: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: NotificationDedupService,
          useValue: { checkAndMarkSent: jest.fn().mockResolvedValue(false) },
        },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();
    service = module.get(DiscordNotificationService);
  });

  it('defaults lfg_invite to discord ON in the shared matrix', () => {
    expect(DEFAULT_CHANNEL_PREFS.lfg_invite).toEqual({
      inApp: true,
      push: false,
      discord: true,
    });
  });

  it('sends when the stored prefs carry no lfg_invite key (opt-OUT)', async () => {
    storedPrefs({ event_reminder: { inApp: true, push: true, discord: true } });

    const sent = await service.dispatch({
      notificationId: 'n-1',
      userId: 1,
      type: 'lfg_invite',
      title: 'Deep Rock Galactic — 2 looking to play',
      message: 'Join the group',
    });

    expect(sent).toBe(true);
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('does not send when the user turned lfg_invite discord off', async () => {
    storedPrefs({ lfg_invite: { inApp: true, push: false, discord: false } });

    const sent = await service.dispatch({
      notificationId: 'n-1',
      userId: 1,
      type: 'lfg_invite',
      title: 'Deep Rock Galactic — 2 looking to play',
      message: 'Join the group',
    });

    expect(sent).toBe(false);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
