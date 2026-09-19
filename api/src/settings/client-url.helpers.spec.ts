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

  it('accepts only http and https schemes', () => {
    expect(originOf('http://raid.example/callback')).toBe(
      'http://raid.example',
    );
    expect(originOf('javascript:alert(1)')).toBeUndefined();
    expect(originOf('ftp://raid.example/callback')).toBeUndefined();
    expect(originOf('file:///etc/passwd')).toBeUndefined();
    expect(originOf('foo:bar')).toBeUndefined();
  });

  it('never returns the opaque-origin literal "null"', () => {
    expect(originOf('foo:bar')).not.toBe('null');
    expect(originOf('file:///x')).not.toBe('null');
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

  it('rejects a non-http(s) client_url anchor and falls through', () => {
    const resolved = resolveSeedClientUrl(
      anchors({
        settingClientUrl: 'javascript:alert(1)',
        settingDiscordCallbackUrl: 'ftp://raid.example/callback',
        envDiscordCallbackUrl: 'https://env.example/auth/callback',
      }),
    );
    expect(resolved).toBe('https://env.example');
  });

  it('returns undefined when every anchor uses an unsupported scheme', () => {
    const resolved = resolveSeedClientUrl(
      anchors({
        settingClientUrl: 'foo:bar',
        settingDiscordCallbackUrl: 'file:///x',
        envDiscordCallbackUrl: 'javascript:alert(1)',
      }),
    );
    expect(resolved).toBeUndefined();
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
