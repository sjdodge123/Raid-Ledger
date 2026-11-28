/**
 * ROK-2371 (Codex P2): the Google sign-in redirect URIs are built the way the
 * Discord OAuth callback is — off its API base — so every topology works:
 * allinone behind nginx `/api`, docker dev / local Vite (Nest on :3000
 * without `/api`), a platform public URL, and a custom Discord callback.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';
import {
  apiBaseFromDiscordCallback,
  googleSigninRedirectUris,
} from './settings-google-signin.helpers';

function settingsWith(values: Partial<Record<string, string>>): SettingsCore {
  return {
    get: (key) => Promise.resolve(values[key] ?? null),
    set: () => Promise.resolve(),
    exists: (key) => Promise.resolve(values[key] !== undefined),
    delete: () => Promise.resolve(),
  };
}

describe('apiBaseFromDiscordCallback', () => {
  it.each([
    [
      'allinone behind nginx /api',
      'https://raid.example.test/api/auth/discord/callback',
      'https://raid.example.test/api',
    ],
    [
      'docker dev / local Vite (Nest on :3000, no /api)',
      'http://localhost:3000/auth/discord/callback',
      'http://localhost:3000',
    ],
    [
      'a trailing slash',
      'https://raid.example.test/api/auth/discord/callback/',
      'https://raid.example.test/api',
    ],
  ])('%s', (_label, discordCallback, expected) => {
    expect(
      apiBaseFromDiscordCallback(discordCallback, 'https://client.test'),
    ).toBe(expected);
  });

  it('falls back to <CLIENT_URL>/api for a custom Discord callback path', () => {
    expect(
      apiBaseFromDiscordCallback(
        'https://raid.example.test/custom/discord',
        'https://raid.example.test/',
      ),
    ).toBe('https://raid.example.test/api');
  });
});

describe('googleSigninRedirectUris', () => {
  it('uses the saved Discord callback setting first (allinone)', async () => {
    const svc = settingsWith({
      [SETTING_KEYS.DISCORD_CALLBACK_URL]:
        'https://raid.example.test/api/auth/discord/callback',
    });
    await expect(
      googleSigninRedirectUris(svc, { DISCORD_CALLBACK_URL: 'http://x/y' }),
    ).resolves.toEqual({
      signin: 'https://raid.example.test/api/auth/google/callback',
      link: 'https://raid.example.test/api/auth/google/link/callback',
    });
  });

  it('then the DISCORD_CALLBACK_URL env var (docker dev)', async () => {
    await expect(
      googleSigninRedirectUris(settingsWith({}), {
        DISCORD_CALLBACK_URL: 'http://localhost:3000/auth/discord/callback',
      }),
    ).resolves.toEqual({
      signin: 'http://localhost:3000/auth/google/callback',
      link: 'http://localhost:3000/auth/google/link/callback',
    });
  });

  it('then the platform public URL behind /api', async () => {
    await expect(
      googleSigninRedirectUris(settingsWith({}), {
        PUBLIC_URL: 'https://slot-1.example.test',
      }),
    ).resolves.toEqual({
      signin: 'https://slot-1.example.test/api/auth/google/callback',
      link: 'https://slot-1.example.test/api/auth/google/link/callback',
    });
  });

  it('else the local Nest URL (Vite :5173 has no /api proxy)', async () => {
    await expect(
      googleSigninRedirectUris(settingsWith({}), {}),
    ).resolves.toEqual({
      signin: 'http://localhost:3000/auth/google/callback',
      link: 'http://localhost:3000/auth/google/link/callback',
    });
  });
});
