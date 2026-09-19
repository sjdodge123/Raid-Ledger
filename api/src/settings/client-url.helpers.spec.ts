/**
 * ROK-1627 — trusted-anchor resolution for `CLIENT_URL`.
 *
 * The value is only ever allowed to come from a deployer-controlled anchor.
 * "Nothing trusted" must resolve to `undefined`, never to a guessed default.
 */
import {
  isUnset,
  originOf,
  resolveSeedClientUrl,
  type ClientUrlAnchors,
} from './client-url.helpers';
import { DEFAULT_CLIENT_URL } from './settings-bot.helpers';

/** Anchor set with every source absent; override per test. */
function anchors(overrides: Partial<ClientUrlAnchors> = {}): ClientUrlAnchors {
  return {
    settingClientUrl: null,
    settingDiscordCallbackUrl: null,
    envDiscordCallbackUrl: undefined,
    ...overrides,
  };
}

describe('isUnset', () => {
  it('treats null, undefined, empty and blank strings as unset', () => {
    expect(isUnset(null)).toBe(true);
    expect(isUnset(undefined)).toBe(true);
    expect(isUnset('')).toBe(true);
    expect(isUnset('   ')).toBe(true);
    expect(isUnset('https://raid.example')).toBe(false);
  });
});

describe('originOf', () => {
  it('reduces a URL to its origin', () => {
    expect(originOf('https://raid.example/auth/discord/callback')).toBe(
      'https://raid.example',
    );
  });

  it('returns undefined for values that do not parse as a URL', () => {
    expect(originOf('not-a-url')).toBeUndefined();
    expect(originOf('')).toBeUndefined();
    expect(originOf(null)).toBeUndefined();
  });
});

describe('resolveSeedClientUrl', () => {
  it('prefers the app_settings client_url over every other anchor', () => {
    const resolved = resolveSeedClientUrl(
      anchors({
        settingClientUrl: 'https://operator.example',
        settingDiscordCallbackUrl: 'https://callback.example/auth/callback',
        envDiscordCallbackUrl: 'https://env.example/auth/callback',
      }),
    );
    expect(resolved).toBe('https://operator.example');
  });

  it('strips a trailing slash so redirect paths do not double up', () => {
    expect(
      resolveSeedClientUrl(
        anchors({ settingClientUrl: 'https://raid.example/' }),
      ),
    ).toBe('https://raid.example');
  });

  it('falls back to the origin of the app_settings discord callback URL', () => {
    const resolved = resolveSeedClientUrl(
      anchors({
        settingDiscordCallbackUrl: 'https://raid.example/auth/discord/callback',
        envDiscordCallbackUrl: 'https://env.example/auth/discord/callback',
      }),
    );
    expect(resolved).toBe('https://raid.example');
  });

  it('falls back to the origin of the DISCORD_CALLBACK_URL env var last', () => {
    const resolved = resolveSeedClientUrl(
      anchors({ envDiscordCallbackUrl: 'https://env.example/auth/callback' }),
    );
    expect(resolved).toBe('https://env.example');
  });

  it('skips an unparseable anchor and uses the next one in order', () => {
    const resolved = resolveSeedClientUrl(
      anchors({
        settingClientUrl: 'not-a-url',
        settingDiscordCallbackUrl: 'also-not-a-url',
        envDiscordCallbackUrl: 'https://env.example/auth/callback',
      }),
    );
    expect(resolved).toBe('https://env.example');
  });

  it('treats empty-string anchors as unset', () => {
    const resolved = resolveSeedClientUrl(
      anchors({
        settingClientUrl: '',
        settingDiscordCallbackUrl: '',
        envDiscordCallbackUrl: '',
      }),
    );
    expect(resolved).toBeUndefined();
  });

  it('returns undefined — never the localhost default — when nothing is trusted', () => {
    const resolved = resolveSeedClientUrl(anchors());
    expect(resolved).toBeUndefined();
    expect(resolved).not.toBe(DEFAULT_CLIENT_URL);
  });
});
