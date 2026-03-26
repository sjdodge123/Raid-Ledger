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

describe('settings-discord.helpers', () => {
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
