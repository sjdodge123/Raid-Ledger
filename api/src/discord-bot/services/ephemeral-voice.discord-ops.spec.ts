/**
 * Unit tests for the ephemeral-voice Discord ops added for the in-flight
 * name backfill: reading the current channel name, renaming a channel, and the
 * no-churn Scheduled-Event name reconcile (rename only when Discord's current
 * name differs).
 */
import {
  getEphemeralChannelName,
  renameVoiceChannel,
  reconcileScheduledEventName,
} from './ephemeral-voice.discord-ops';

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
