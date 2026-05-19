import {
  getClientUrl,
  getDiscordOAuthConfig,
  DEFAULT_CLIENT_URL,
  type SettingsCore,
} from './settings-bot.helpers';
import { SETTING_KEYS } from '../drizzle/schema';

/** Build a mock SettingsCore with configurable key-value responses. */
function mockSettingsCore(
  values: Partial<Record<string, string>> = {},
): SettingsCore {
  return {
    get: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
    set: jest.fn(),
    exists: jest.fn(),
    delete: jest.fn(),
  };
}

describe('getClientUrl', () => {
  const originalEnv = process.env.CLIENT_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLIENT_URL = originalEnv;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  it('should return explicit CLIENT_URL setting when present', async () => {
    const svc = mockSettingsCore({
      [SETTING_KEYS.CLIENT_URL]: 'https://raid.example.com',
    });
    const url = await getClientUrl(svc);
    expect(url).toBe('https://raid.example.com');
  });

  it('should fall back to process.env.CLIENT_URL when setting is missing', async () => {
    process.env.CLIENT_URL = 'https://env.example.com';
    const svc = mockSettingsCore();
    const url = await getClientUrl(svc);
    expect(url).toBe('https://env.example.com');
  });

  it('should derive URL from DISCORD_CALLBACK_URL origin when other sources are missing', async () => {
    delete process.env.CLIENT_URL;
    const svc = mockSettingsCore({
      [SETTING_KEYS.DISCORD_CALLBACK_URL]:
        'https://app.example.com/auth/discord/callback',
    });
    const url = await getClientUrl(svc);
    expect(url).toBe('https://app.example.com');
  });

  it('should return DEFAULT_CLIENT_URL when no source is configured', async () => {
    delete process.env.CLIENT_URL;
    const svc = mockSettingsCore();
    const url = await getClientUrl(svc);
    expect(url).toBe(DEFAULT_CLIENT_URL);
  });

  it('should return DEFAULT_CLIENT_URL when callback URL is invalid', async () => {
    delete process.env.CLIENT_URL;
    const svc = mockSettingsCore({
      [SETTING_KEYS.DISCORD_CALLBACK_URL]: 'not-a-url',
    });
    const url = await getClientUrl(svc);
    expect(url).toBe(DEFAULT_CLIENT_URL);
  });

  it('should prefer explicit setting over env var', async () => {
    process.env.CLIENT_URL = 'https://env.example.com';
    const svc = mockSettingsCore({
      [SETTING_KEYS.CLIENT_URL]: 'https://setting.example.com',
    });
    const url = await getClientUrl(svc);
    expect(url).toBe('https://setting.example.com');
  });
});

describe('DEFAULT_CLIENT_URL', () => {
  it('should be the standard localhost dev URL', () => {
    expect(DEFAULT_CLIENT_URL).toBe('http://localhost:5173');
  });
});

describe('getDiscordOAuthConfig — callbackUrl fallback chain (ROK-1325)', () => {
  const originalEnv = process.env.DISCORD_CALLBACK_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DISCORD_CALLBACK_URL = originalEnv;
    } else {
      delete process.env.DISCORD_CALLBACK_URL;
    }
  });

  it('AC1 — falls back to process.env.DISCORD_CALLBACK_URL when setting is null', async () => {
    process.env.DISCORD_CALLBACK_URL =
      'https://slot-1.gamernight.net/api/auth/discord/callback';
    const svc = mockSettingsCore({
      [SETTING_KEYS.DISCORD_CLIENT_ID]: 'client-id',
      [SETTING_KEYS.DISCORD_CLIENT_SECRET]: 'client-secret',
      // DISCORD_CALLBACK_URL setting NOT set → SettingsCore.get returns null
    });

    const config = await getDiscordOAuthConfig(svc);

    expect(config).not.toBeNull();
    expect(config!.callbackUrl).toBe(
      'https://slot-1.gamernight.net/api/auth/discord/callback',
    );
  });

  it('AC2 — setting wins over env var when both present', async () => {
    process.env.DISCORD_CALLBACK_URL =
      'https://env-var.example/api/auth/discord/callback';
    const svc = mockSettingsCore({
      [SETTING_KEYS.DISCORD_CLIENT_ID]: 'client-id',
      [SETTING_KEYS.DISCORD_CLIENT_SECRET]: 'client-secret',
      [SETTING_KEYS.DISCORD_CALLBACK_URL]:
        'https://from-setting.example/api/auth/discord/callback',
    });

    const config = await getDiscordOAuthConfig(svc);

    expect(config).not.toBeNull();
    expect(config!.callbackUrl).toBe(
      'https://from-setting.example/api/auth/discord/callback',
    );
  });

  it('AC3 — hardcoded localhost is the last-resort default when neither setting nor env is set', async () => {
    delete process.env.DISCORD_CALLBACK_URL;
    const svc = mockSettingsCore({
      [SETTING_KEYS.DISCORD_CLIENT_ID]: 'client-id',
      [SETTING_KEYS.DISCORD_CLIENT_SECRET]: 'client-secret',
      // DISCORD_CALLBACK_URL setting NOT set, env var deleted above
    });

    const config = await getDiscordOAuthConfig(svc);

    expect(config).not.toBeNull();
    expect(config!.callbackUrl).toBe(
      'http://localhost:3000/auth/discord/callback',
    );
  });
});
