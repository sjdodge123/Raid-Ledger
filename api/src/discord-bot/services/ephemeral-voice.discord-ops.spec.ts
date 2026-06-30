/**
 * Unit tests for the ephemeral-voice Discord ops.
 *
 * Covers two independent op groups:
 *  - name backfill (ROK ephemeral-name): reading the current channel name,
 *    renaming a channel, and the no-churn Scheduled-Event name reconcile
 *    (rename only when Discord's current name differs).
 *  - private-event overwrites (ROK-1386): the full overwrite reconcile that
 *    adds rostered members, removes stale ones, and re-asserts the base lock.
 */
import { OverwriteType } from 'discord.js';
import {
  getEphemeralChannelName,
  renameVoiceChannel,
  reconcileScheduledEventName,
  applyPrivateVoiceOverwrites,
} from './ephemeral-voice.discord-ops';

jest.mock('./scheduled-event.helpers', () => ({
  timedDiscordCall: (_label: string, fn: () => unknown) => fn(),
}));

interface FakeGuild {
  channels: {
    cache: Map<string, { name: string }>;
    edit: jest.Mock;
  };
  scheduledEvents: {
    cache: Map<string, { name: string }>;
    fetch: jest.Mock;
    edit: jest.Mock;
  };
}

function makeGuild(): FakeGuild {
  return {
    channels: {
      cache: new Map(),
      edit: jest.fn().mockResolvedValue(undefined),
    },
    scheduledEvents: {
      cache: new Map(),
      fetch: jest.fn(),
      edit: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('getEphemeralChannelName', () => {
  it('returns the cached channel name', () => {
    const guild = makeGuild();
    guild.channels.cache.set('ch-1', { name: '⏰ HELLCARD' });
    expect(getEphemeralChannelName(guild as never, 'ch-1')).toBe('⏰ HELLCARD');
  });

  it('returns null when the channel is not in cache', () => {
    expect(getEphemeralChannelName(makeGuild() as never, 'gone')).toBeNull();
  });
});

describe('renameVoiceChannel', () => {
  it('edits the channel with the new name', async () => {
    const guild = makeGuild();
    await renameVoiceChannel(guild as never, 'ch-1', '⏰ NEW');
    expect(guild.channels.edit).toHaveBeenCalledWith('ch-1', {
      name: '⏰ NEW',
    });
  });
});

describe('reconcileScheduledEventName (no-churn)', () => {
  it('renames the SE when the cached name differs and returns true', async () => {
    const guild = makeGuild();
    guild.scheduledEvents.cache.set('se-1', {
      name: 'HELLCARD Event · Sun 9:35 PM',
    });
    const renamed = await reconcileScheduledEventName(
      guild as never,
      'se-1',
      'HELLCARD · Sun 9:35 PM',
    );
    expect(renamed).toBe(true);
    expect(guild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
      name: 'HELLCARD · Sun 9:35 PM',
    });
  });

  it('is a no-op when the cached name already matches (no edit, false)', async () => {
    const guild = makeGuild();
    guild.scheduledEvents.cache.set('se-1', { name: 'HELLCARD · Sun 9:35 PM' });
    const renamed = await reconcileScheduledEventName(
      guild as never,
      'se-1',
      'HELLCARD · Sun 9:35 PM',
    );
    expect(renamed).toBe(false);
    expect(guild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('fetches on a cold cache, then renames when different', async () => {
    const guild = makeGuild();
    guild.scheduledEvents.fetch.mockResolvedValue({ name: 'OLD' });
    const renamed = await reconcileScheduledEventName(
      guild as never,
      'se-1',
      'NEW',
    );
    expect(guild.scheduledEvents.fetch).toHaveBeenCalledWith('se-1');
    expect(renamed).toBe(true);
    expect(guild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
      name: 'NEW',
    });
  });

  it('returns false without editing when the SE is gone (fetch fails)', async () => {
    const guild = makeGuild();
    guild.scheduledEvents.fetch.mockRejectedValue(new Error('Unknown event'));
    const renamed = await reconcileScheduledEventName(
      guild as never,
      'se-1',
      'NEW',
    );
    expect(renamed).toBe(false);
    expect(guild.scheduledEvents.edit).not.toHaveBeenCalled();
  });
});

const BOT = 'bot-id';
const GUILD = 'guild-id';

function memberOverwrite(id: string) {
  return { id, type: OverwriteType.Member };
}

function buildChannel(currentMemberIds: string[]) {
  const cache = new Map<string, { id: string; type: number }>();
  cache.set(GUILD, { id: GUILD, type: OverwriteType.Role });
  cache.set(BOT, memberOverwrite(BOT));
  for (const id of currentMemberIds) cache.set(id, memberOverwrite(id));
  const po = {
    cache,
    edit: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const channel = { isVoiceBased: () => true, permissionOverwrites: po };
  return { channel, po };
}

function buildGuild(channel: unknown) {
  return {
    id: GUILD,
    channels: {
      cache: { get: () => channel },
      fetch: jest.fn(),
    },
  } as never;
}

describe('applyPrivateVoiceOverwrites — full reconcile (ROK-1386)', () => {
  it('adds missing rostered members and removes stale ones', async () => {
    const { channel, po } = buildChannel(['stay', 'stale']);
    await applyPrivateVoiceOverwrites(
      buildGuild(channel),
      'ch1',
      new Set(['stay', 'new']),
      BOT,
    );
    // base lock re-asserted for @everyone + bot, plus the added member
    expect(po.edit).toHaveBeenCalledWith(GUILD, {
      Connect: false,
      ViewChannel: true,
    });
    expect(po.edit).toHaveBeenCalledWith(BOT, {
      Connect: true,
      ViewChannel: true,
    });
    expect(po.edit).toHaveBeenCalledWith('new', {
      Connect: true,
      ViewChannel: true,
    });
    // stale member removed; 'stay' left untouched
    expect(po.delete).toHaveBeenCalledTimes(1);
    expect(po.delete).toHaveBeenCalledWith('stale');
  });

  it('is a no-op when the channel no longer exists', async () => {
    const guild = {
      id: GUILD,
      channels: {
        cache: { get: () => undefined },
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as never;
    await expect(
      applyPrivateVoiceOverwrites(guild, 'gone', new Set(['x']), BOT),
    ).resolves.toBeUndefined();
  });
});
