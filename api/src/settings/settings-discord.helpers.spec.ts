/**
 * Unit tests for settings-discord.helpers.ts — Discord bot convenience helpers
 * delegated from SettingsService.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';
import {
  getDiscordBotDefaultChannel,
  setDiscordBotDefaultChannel,
  isDiscordBotSetupCompleted,
  markDiscordBotSetupCompleted,
  getDiscordBotCommunityName,
  setDiscordBotCommunityName,
  getDiscordBotTimezone,
  setDiscordBotTimezone,
  getDefaultTimezone,
  setDefaultTimezone,
  getDiscordBotDefaultVoiceChannel,
  setDiscordBotDefaultVoiceChannel,
  setWeeklyDigestSettings,
} from './settings-discord.helpers';

function createMockSettingsCore(): SettingsCore & {
  _store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: jest.fn((key) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key, value) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    exists: jest.fn((key) => Promise.resolve(store.has(key))),
    delete: jest.fn((key) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
}

describe('settings-discord.helpers — channel, setup and community name', () => {
  let svc: ReturnType<typeof createMockSettingsCore>;

  beforeEach(() => {
    svc = createMockSettingsCore();
  });

  describe('getDiscordBotDefaultChannel / setDiscordBotDefaultChannel', () => {
    it('returns null when no channel is configured', async () => {
      const result = await getDiscordBotDefaultChannel(svc);
      expect(result).toBeNull();
    });

    it('returns the channel ID after setting it', async () => {
      await setDiscordBotDefaultChannel(svc, '123456789');
      const result = await getDiscordBotDefaultChannel(svc);
      expect(result).toBe('123456789');
    });
  });

  describe('isDiscordBotSetupCompleted / markDiscordBotSetupCompleted', () => {
    it('returns false when not set', async () => {
      const result = await isDiscordBotSetupCompleted(svc);
      expect(result).toBe(false);
    });

    it('returns true after marking completed', async () => {
      await markDiscordBotSetupCompleted(svc);
      const result = await isDiscordBotSetupCompleted(svc);
      expect(result).toBe(true);
    });

    it('returns false when value is not "true"', async () => {
      svc._store.set(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED, 'false');
      const result = await isDiscordBotSetupCompleted(svc);
      expect(result).toBe(false);
    });
  });

  describe('getDiscordBotCommunityName / setDiscordBotCommunityName', () => {
    it('returns null when not set', async () => {
      const result = await getDiscordBotCommunityName(svc);
      expect(result).toBeNull();
    });

    it('returns the name after setting it', async () => {
      await setDiscordBotCommunityName(svc, 'Epic Raiders');
      const result = await getDiscordBotCommunityName(svc);
      expect(result).toBe('Epic Raiders');
    });
  });
});

describe('settings-discord.helpers — timezones and voice channel', () => {
  let svc: ReturnType<typeof createMockSettingsCore>;

  beforeEach(() => {
    svc = createMockSettingsCore();
  });

  describe('getDiscordBotTimezone / setDiscordBotTimezone', () => {
    it('returns null when not set', async () => {
      const result = await getDiscordBotTimezone(svc);
      expect(result).toBeNull();
    });

    it('returns the timezone after setting it', async () => {
      await setDiscordBotTimezone(svc, 'America/New_York');
      const result = await getDiscordBotTimezone(svc);
      expect(result).toBe('America/New_York');
    });
  });

  describe('getDefaultTimezone / setDefaultTimezone', () => {
    it('returns null when not set', async () => {
      const result = await getDefaultTimezone(svc);
      expect(result).toBeNull();
    });

    it('returns the timezone after setting it', async () => {
      await setDefaultTimezone(svc, 'Europe/London');
      const result = await getDefaultTimezone(svc);
      expect(result).toBe('Europe/London');
    });
  });

  describe('getDiscordBotDefaultVoiceChannel / setDiscordBotDefaultVoiceChannel', () => {
    it('returns null when not set', async () => {
      const result = await getDiscordBotDefaultVoiceChannel(svc);
      expect(result).toBeNull();
    });

    it('returns the channel ID after setting it', async () => {
      await setDiscordBotDefaultVoiceChannel(svc, '987654321');
      const result = await getDiscordBotDefaultVoiceChannel(svc);
      expect(result).toBe('987654321');
    });
  });
});

describe('setWeeklyDigestSettings (ROK-1435)', () => {
  const VALUE = {
    enabled: true,
    channelId: '123456789012345678',
    day: 5,
    hour: 18,
  };

  /** A SettingsCore whose writes resolve on the next tick, counting overlap. */
  function trackingCore(failKey?: string) {
    const written: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const write = (key: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<void>((resolve, reject) =>
        setImmediate(() => {
          inFlight--;
          if (key === failKey) return reject(new Error(`write ${key} failed`));
          written.push(key);
          resolve();
        }),
      );
    };
    const svc: SettingsCore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn((key: string) => write(key)),
      exists: jest.fn().mockResolvedValue(false),
      delete: jest.fn((key: string) => write(`delete:${key}`)),
    };
    return { svc, written, maxInFlight: () => maxInFlight };
  }

  it('writes one key at a time, the enabled flag last', async () => {
    const { svc, written, maxInFlight } = trackingCore();
    await setWeeklyDigestSettings(svc, VALUE);
    expect(maxInFlight()).toBe(1);
    expect(written).toEqual([
      SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID,
      SETTING_KEYS.WEEKLY_DIGEST_DAY,
      SETTING_KEYS.WEEKLY_DIGEST_HOUR,
      SETTING_KEYS.WEEKLY_DIGEST_ENABLED,
    ]);
  });

  it('stops at the first failed write, so a half-saved digest is never enabled', async () => {
    const { svc, written } = trackingCore(SETTING_KEYS.WEEKLY_DIGEST_DAY);
    await expect(setWeeklyDigestSettings(svc, VALUE)).rejects.toThrow(
      `write ${SETTING_KEYS.WEEKLY_DIGEST_DAY} failed`,
    );
    expect(written).toEqual([SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID]);
    expect(svc.set).not.toHaveBeenCalledWith(
      SETTING_KEYS.WEEKLY_DIGEST_ENABLED,
      expect.anything(),
    );
  });

  it('deletes the channel key when channelId is null', async () => {
    const { svc, written } = trackingCore();
    await setWeeklyDigestSettings(svc, { ...VALUE, channelId: null });
    expect(written[0]).toBe(`delete:${SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID}`);
  });
});
