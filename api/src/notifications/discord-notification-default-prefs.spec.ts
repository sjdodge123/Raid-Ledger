/**
 * TDB:899 — every Discord send-side preference read resolves the stored JSONB
 * over `DEFAULT_CHANNEL_PREFS`, the same way the in-app path
 * (`mapPreferencesToDto`) and the settings UI do.
 *
 * Before the fix the single-DM path (`isTypeDisabledForUser`) and the batch
 * path (`loadDisabledTypes`) indexed the raw stored row: a type missing from
 * an older row, or a user with no row at all, was treated as discord ON even
 * when its default is discord OFF (e.g. `achievement_unlocked`).
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
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
import { dispatchManyDiscordNotifications } from './discord-notification-batch.helpers';
import {
  discordDisabledTypes,
  resolveChannelPrefs,
} from './notification-mapping.helpers';

/** A row written before `achievement_unlocked` had a key in it. */
const OLD_ROW_PREFS = {
  event_reminder: { inApp: true, push: true, discord: true },
};

describe('DiscordNotificationService.dispatch — defaults merge (TDB:899)', () => {
  let service: DiscordNotificationService;
  let mockDb: MockDb;
  const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };

  /** First limit() = the users read, second = the prefs row (or none). */
  function givenPrefsRow(channelPrefs: Record<string, unknown> | null): void {
    mockDb.limit
      .mockResolvedValueOnce([{ discordId: '123456789012345678' }])
      .mockResolvedValueOnce(channelPrefs ? [{ channelPrefs }] : []);
  }

  function dispatchType(type: 'achievement_unlocked' | 'event_reminder') {
    return service.dispatch({
      notificationId: 'n-1',
      userId: 1,
      type,
      title: 'title',
      message: 'message',
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb = createDrizzleMock();
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
          useValue: { isConnected: jest.fn().mockReturnValue(true) },
        },
        { provide: DiscordNotificationEmbedService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: NotificationDedupService, useValue: {} },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();
    service = module.get(DiscordNotificationService);
  });

  it('pins the default this suite relies on (achievement_unlocked is discord OFF)', () => {
    expect(DEFAULT_CHANNEL_PREFS.achievement_unlocked.discord).toBe(false);
  });

  it('does not DM a type missing from the stored row when its default is discord OFF', async () => {
    givenPrefsRow(OLD_ROW_PREFS);

    const sent = await dispatchType('achievement_unlocked');

    expect(`achievement_unlocked sent=${sent}`).toBe(
      'achievement_unlocked sent=false',
    );
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('does not DM a default-OFF type to a user with no prefs row', async () => {
    givenPrefsRow(null);

    const sent = await dispatchType('achievement_unlocked');

    expect(`no-row achievement_unlocked sent=${sent}`).toBe(
      'no-row achievement_unlocked sent=false',
    );
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('still DMs a type missing from the stored row when its default is discord ON', async () => {
    givenPrefsRow({ lfg_invite: { inApp: true, push: false, discord: true } });

    const sent = await dispatchType('event_reminder');

    expect(sent).toBe(true);
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
  });

  it('a stored discord:true overrides a default-OFF type', async () => {
    givenPrefsRow({
      achievement_unlocked: { inApp: true, push: false, discord: true },
    });

    const sent = await dispatchType('achievement_unlocked');

    expect(sent).toBe(true);
  });
});

describe('dispatchManyDiscordNotifications — defaults merge (TDB:899)', () => {
  /** users → both linked; prefs → user 1 has an old row, user 2 has none. */
  function batchDb(): PostgresJsDatabase<typeof schema> {
    const byTable = new Map<unknown, unknown[]>([
      [
        schema.users,
        [
          { id: 1, discordId: '111111111111111111', deactivatedAt: null },
          { id: 2, discordId: '222222222222222222', deactivatedAt: null },
        ],
      ],
      [
        schema.userNotificationPreferences,
        [{ userId: 1, channelPrefs: OLD_ROW_PREFS }],
      ],
    ]);
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => Promise.resolve(byTable.get(table) ?? []),
        }),
      }),
    };
    return db as unknown as PostgresJsDatabase<typeof schema>;
  }

  function mocks() {
    const pipeline = { set: jest.fn(), exec: jest.fn().mockResolvedValue([]) };
    const redis = {
      mget: jest.fn((...keys: string[]) =>
        Promise.resolve(keys.map(() => null)),
      ),
      pipeline: () => pipeline,
    };
    const queue = { addBulk: jest.fn().mockResolvedValue([]) };
    return {
      redis: redis as unknown as Redis,
      queue: queue as unknown as Queue,
      addBulk: queue.addBulk,
    };
  }

  function inputs(type: 'achievement_unlocked' | 'event_reminder') {
    return [1, 2].map((userId) => ({
      notificationId: `n-${userId}`,
      userId,
      type,
      title: 'title',
      message: 'message',
    }));
  }

  it('skips a default-OFF type for a user whose row lacks it and for a row-less user', async () => {
    const { redis, queue, addBulk } = mocks();

    const count = await dispatchManyDiscordNotifications(
      batchDb(),
      queue,
      redis,
      new Logger('test'),
      true,
      inputs('achievement_unlocked'),
    );

    expect(`batch achievement_unlocked enqueued=${count}`).toBe(
      'batch achievement_unlocked enqueued=0',
    );
    expect(addBulk).not.toHaveBeenCalled();
  });

  it('still enqueues a default-ON type for both users', async () => {
    const { redis, queue, addBulk } = mocks();

    const count = await dispatchManyDiscordNotifications(
      batchDb(),
      queue,
      redis,
      new Logger('test'),
      true,
      inputs('event_reminder'),
    );

    expect(count).toBe(2);
    expect(addBulk).toHaveBeenCalledTimes(1);
  });
});

describe('resolveChannelPrefs / discordDisabledTypes (TDB:899)', () => {
  it('resolves a missing row to a copy of the defaults', () => {
    expect(resolveChannelPrefs(null)).toEqual(DEFAULT_CHANNEL_PREFS);
    expect(resolveChannelPrefs(undefined)).not.toBe(DEFAULT_CHANNEL_PREFS);
  });

  it('overlays stored channels per type and fills missing types from defaults', () => {
    const resolved = resolveChannelPrefs({
      event_reminder: { discord: false },
    });

    expect(resolved.event_reminder).toEqual({
      inApp: true,
      push: true,
      discord: false,
    });
    expect(resolved.achievement_unlocked).toEqual(
      DEFAULT_CHANNEL_PREFS.achievement_unlocked,
    );
  });

  it('never mutates DEFAULT_CHANNEL_PREFS', () => {
    const before = JSON.stringify(DEFAULT_CHANNEL_PREFS);
    resolveChannelPrefs({ slot_vacated: { discord: false } });
    expect(JSON.stringify(DEFAULT_CHANNEL_PREFS)).toBe(before);
  });

  it('ignores stored keys that are not notification types', () => {
    expect(resolveChannelPrefs({ bogus: { discord: false } })).toEqual(
      DEFAULT_CHANNEL_PREFS,
    );
  });

  it('lists exactly the default-OFF discord types for a missing row', () => {
    const expected = Object.entries(DEFAULT_CHANNEL_PREFS)
      .filter(([, channels]) => channels.discord === false)
      .map(([type]) => type)
      .sort();

    expect([...discordDisabledTypes(null)].sort()).toEqual(expected);
  });
});
