/**
 * Unit tests for resolveLineupChannel + loadLineupChannelOverride (ROK-1064).
 *
 * Covers:
 *   - returns override when bot has post permissions
 *   - falls back to settings chain when override is null/undefined
 *   - falls back + warns once via dedup when perms are missing
 *   - falls back when guild is unavailable (bot disconnected)
 *   - falls back when channel is missing from guild cache
 */
import { Logger } from '@nestjs/common';
import {
  resolveLineupChannel,
  loadLineupChannelOverride,
} from './lineup-notification-channel.helpers';
import type { SettingsService } from '../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';

const LINEUP_ID = 42;
const OVERRIDE_ID = '987654321098765432';
const BOUND_ID = '123456789012345678';

interface FakeChannelOpts {
  hasPerms?: boolean;
  missing?: boolean;
  isThread?: boolean;
  isDM?: boolean;
  isText?: boolean;
}

function buildFakeGuild(opts: FakeChannelOpts = {}) {
  if (opts.missing) {
    return {
      members: { me: { permissionsIn: () => ({ has: () => false }) } },
      channels: { cache: { get: () => undefined } },
    } as unknown as ReturnType<DiscordBotClientService['getGuild']>;
  }
  const fakeChannel = {
    id: OVERRIDE_ID,
    name: 'override',
    isTextBased: () => opts.isText !== false,
    isThread: () => opts.isThread === true,
    isDMBased: () => opts.isDM === true,
    permissionsFor: () => ({ has: () => opts.hasPerms === true }),
  };
  return {
    members: {
      me: {
        permissionsIn: () => ({ has: () => opts.hasPerms === true }),
      },
    },
    channels: {
      cache: {
        get: (id: string) => (id === OVERRIDE_ID ? fakeChannel : undefined),
      },
    },
  } as unknown as ReturnType<DiscordBotClientService['getGuild']>;
}

function makeSettings(): jest.Mocked<
  Pick<SettingsService, 'get' | 'getDiscordBotDefaultChannel'>
> {
  return {
    get: jest.fn().mockResolvedValue(null),
    getDiscordBotDefaultChannel: jest.fn().mockResolvedValue(BOUND_ID),
  } as unknown as jest.Mocked<
    Pick<SettingsService, 'get' | 'getDiscordBotDefaultChannel'>
  >;
}

function makeDedup(): jest.Mocked<
  Pick<NotificationDedupService, 'checkAndMarkSent'>
> {
  return {
    checkAndMarkSent: jest.fn().mockResolvedValue(false),
  } as unknown as jest.Mocked<
    Pick<NotificationDedupService, 'checkAndMarkSent'>
  >;
}

function makeBotClient(
  guild: ReturnType<DiscordBotClientService['getGuild']> | null,
): jest.Mocked<Pick<DiscordBotClientService, 'getGuild'>> {
  return {
    getGuild: jest.fn().mockReturnValue(guild),
  } as unknown as jest.Mocked<Pick<DiscordBotClientService, 'getGuild'>>;
}

describe('resolveLineupChannel (ROK-1064)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns override when bot has post permissions', async () => {
    const result = await resolveLineupChannel(
      makeSettings() as unknown as SettingsService,
      makeBotClient(
        buildFakeGuild({ hasPerms: true }),
      ) as unknown as DiscordBotClientService,
      makeDedup() as unknown as NotificationDedupService,
      LINEUP_ID,
      OVERRIDE_ID,
    );
    expect(result).toBe(OVERRIDE_ID);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to bound channel when override is null', async () => {
    const settings = makeSettings();
    const result = await resolveLineupChannel(
      settings as unknown as SettingsService,
      makeBotClient(null) as unknown as DiscordBotClientService,
      makeDedup() as unknown as NotificationDedupService,
      LINEUP_ID,
      null,
    );
    expect(result).toBe(BOUND_ID);
    expect(settings.getDiscordBotDefaultChannel).toHaveBeenCalled();
  });

  it('falls back and warns when bot lacks perms on override', async () => {
    const dedup = makeDedup();
    const result = await resolveLineupChannel(
      makeSettings() as unknown as SettingsService,
      makeBotClient(
        buildFakeGuild({ hasPerms: false }),
      ) as unknown as DiscordBotClientService,
      dedup as unknown as NotificationDedupService,
      LINEUP_ID,
      OVERRIDE_ID,
    );
    expect(result).toBe(BOUND_ID);
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith(
      `lineup-override-fallback:${LINEUP_ID}:${OVERRIDE_ID}`,
      expect.any(Number),
    );
    const matching = warnSpy.mock.calls.filter((c) => {
      const msg = String(c[0] ?? '');
      return msg.includes(String(LINEUP_ID)) && msg.includes(OVERRIDE_ID);
    });
    expect(matching).toHaveLength(1);
  });

  it('does not warn a second time when dedup reports already-warned', async () => {
    const dedup = makeDedup();
    dedup.checkAndMarkSent.mockResolvedValueOnce(true);
    await resolveLineupChannel(
      makeSettings() as unknown as SettingsService,
      makeBotClient(
        buildFakeGuild({ hasPerms: false }),
      ) as unknown as DiscordBotClientService,
      dedup as unknown as NotificationDedupService,
      LINEUP_ID,
      OVERRIDE_ID,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back when guild is unavailable (bot disconnected)', async () => {
    const result = await resolveLineupChannel(
      makeSettings() as unknown as SettingsService,
      makeBotClient(null) as unknown as DiscordBotClientService,
      makeDedup() as unknown as NotificationDedupService,
      LINEUP_ID,
      OVERRIDE_ID,
    );
    expect(result).toBe(BOUND_ID);
  });

  it('falls back when channel missing from guild cache', async () => {
    const result = await resolveLineupChannel(
      makeSettings() as unknown as SettingsService,
      makeBotClient(
        buildFakeGuild({ missing: true }),
      ) as unknown as DiscordBotClientService,
      makeDedup() as unknown as NotificationDedupService,
      LINEUP_ID,
      OVERRIDE_ID,
    );
    expect(result).toBe(BOUND_ID);
  });

  it('falls back when override channel is a thread', async () => {
    const result = await resolveLineupChannel(
      makeSettings() as unknown as SettingsService,
      makeBotClient(
        buildFakeGuild({ hasPerms: true, isThread: true }),
      ) as unknown as DiscordBotClientService,
      makeDedup() as unknown as NotificationDedupService,
      LINEUP_ID,
      OVERRIDE_ID,
    );
    expect(result).toBe(BOUND_ID);
  });
});

describe('loadLineupChannelOverride (ROK-1064)', () => {
  it('returns the override id from the DB row', async () => {
    const limit = jest
      .fn()
      .mockResolvedValue([{ channelOverrideId: OVERRIDE_ID }]);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as unknown as Parameters<
      typeof loadLineupChannelOverride
    >[0];

    const result = await loadLineupChannelOverride(db, LINEUP_ID);
    expect(result).toBe(OVERRIDE_ID);
  });

  it('returns null when the row has no override', async () => {
    const limit = jest.fn().mockResolvedValue([{ channelOverrideId: null }]);
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    } as unknown as Parameters<typeof loadLineupChannelOverride>[0];
    const result = await loadLineupChannelOverride(db, LINEUP_ID);
    expect(result).toBeNull();
  });

  it('returns null when the lineup is missing', async () => {
    const limit = jest.fn().mockResolvedValue([]);
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    } as unknown as Parameters<typeof loadLineupChannelOverride>[0];
    const result = await loadLineupChannelOverride(db, LINEUP_ID);
    expect(result).toBeNull();
  });
});
