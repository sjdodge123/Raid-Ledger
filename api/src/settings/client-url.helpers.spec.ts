/**
 * ROK-1627 — trusted-anchor resolution for `CLIENT_URL`.
 *
 * The value is only ever allowed to come from a deployer-controlled anchor.
 * "Nothing trusted" must resolve to `undefined`, never to a guessed default.
 */
import {
  defaultDiscordCallbackUrl,
  describePublicUrl,
  isUnset,
  originOf,
  resolvePlatformPublicUrl,
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
    platformPublicUrl: undefined,
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

describe('resolveSeedClientUrl — platform public URL (ROK-1697)', () => {
  it('uses the platform public URL only when no other anchor is set', () => {
    expect(
      resolveSeedClientUrl(
        anchors({ platformPublicUrl: 'https://platform.example' }),
      ),
    ).toBe('https://platform.example');
  });

  it.each([
    [
      'settingClientUrl',
      'https://operator.example',
      'https://operator.example',
    ],
    [
      'settingDiscordCallbackUrl',
      'https://callback.example/api/auth/discord/callback',
      'https://callback.example',
    ],
    [
      'envDiscordCallbackUrl',
      'https://env.example/api/auth/discord/callback',
      'https://env.example',
    ],
  ] as const)('%s outranks the platform public URL', (key, value, expected) => {
    const resolved = resolveSeedClientUrl(
      anchors({ [key]: value, platformPublicUrl: 'https://platform.example' }),
    );
    expect(resolved).toBe(expected);
  });
});

describe('resolvePlatformPublicUrl (ROK-1697)', () => {
  it.each([
    ['PUBLIC_URL', 'https://pub.example', 'https://pub.example'],
    [
      'RENDER_EXTERNAL_URL',
      'https://rl.onrender.com',
      'https://rl.onrender.com',
    ],
    ['RAILWAY_PUBLIC_DOMAIN', 'rl.up.railway.app', 'https://rl.up.railway.app'],
    ['FLY_APP_NAME', 'raid-ledger', 'https://raid-ledger.fly.dev'],
    [
      'APP_URL',
      'https://rl.ondigitalocean.app',
      'https://rl.ondigitalocean.app',
    ],
    [
      'HEROKU_APP_DEFAULT_DOMAIN_NAME',
      'rl-1234.herokuapp.com',
      'https://rl-1234.herokuapp.com',
    ],
  ])('resolves %s=%s to %s', (name, value, url) => {
    expect(resolvePlatformPublicUrl({ [name]: value })).toEqual({
      url,
      source: name,
    });
  });

  it('keeps an explicit scheme on a host-style source', () => {
    expect(
      resolvePlatformPublicUrl({ RAILWAY_PUBLIC_DOMAIN: 'https://rl.example' }),
    ).toEqual({ url: 'https://rl.example', source: 'RAILWAY_PUBLIC_DOMAIN' });
  });

  it('trims surrounding whitespace and trailing slashes', () => {
    expect(
      resolvePlatformPublicUrl({ PUBLIC_URL: ' https://a.example// ' }),
    ).toEqual({ url: 'https://a.example', source: 'PUBLIC_URL' });
  });

  it('follows the documented precedence when every source is set', () => {
    const env: Record<string, string> = {
      PUBLIC_URL: 'https://pub.example',
      RENDER_EXTERNAL_URL: 'https://render.example',
      RAILWAY_PUBLIC_DOMAIN: 'railway.example',
      FLY_APP_NAME: 'fly',
      APP_URL: 'https://do.example',
      HEROKU_APP_DEFAULT_DOMAIN_NAME: 'heroku.example',
    };
    const order: string[] = [];
    for (const name of Object.keys(env)) {
      const resolved = resolvePlatformPublicUrl(env);
      order.push(resolved?.source ?? 'none');
      delete env[name];
    }
    expect(order).toEqual([
      'PUBLIC_URL',
      'RENDER_EXTERNAL_URL',
      'RAILWAY_PUBLIC_DOMAIN',
      'FLY_APP_NAME',
      'APP_URL',
      'HEROKU_APP_DEFAULT_DOMAIN_NAME',
    ]);
  });

  it('skips a non-http(s) value with a warning and falls through', () => {
    const warnings: string[] = [];
    const resolved = resolvePlatformPublicUrl(
      {
        PUBLIC_URL: 'ftp://files.example',
        RENDER_EXTERNAL_URL: 'https://r.example',
      },
      (message) => warnings.push(message),
    );
    expect(resolved).toEqual({
      url: 'https://r.example',
      source: 'RENDER_EXTERNAL_URL',
    });
    expect(warnings).toEqual([
      'Ignoring PUBLIC_URL="ftp://files.example": not an http(s) URL',
    ]);
  });

  it('treats blank values as unset without warning', () => {
    const onWarning = jest.fn();
    expect(
      resolvePlatformPublicUrl({ PUBLIC_URL: '  ' }, onWarning),
    ).toBeNull();
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('returns null when no source is set', () => {
    expect(resolvePlatformPublicUrl({})).toBeNull();
  });
});

describe('describePublicUrl (ROK-1697)', () => {
  it('names the URL and its source, or says unresolved', () => {
    expect(
      describePublicUrl({ url: 'https://a.example', source: 'PUBLIC_URL' }),
    ).toBe('public URL: https://a.example (from PUBLIC_URL)');
    expect(describePublicUrl(null)).toBe('public URL: unresolved');
  });
});

describe('defaultDiscordCallbackUrl (ROK-1697)', () => {
  const LOCAL = 'http://localhost/api/auth/discord/callback';

  it('builds the callback from the resolved public URL', () => {
    expect(
      defaultDiscordCallbackUrl({ PUBLIC_URL: 'https://raid.example/' }, LOCAL),
    ).toBe('https://raid.example/api/auth/discord/callback');
  });

  it('falls back to the local default only when nothing resolves', () => {
    expect(defaultDiscordCallbackUrl({}, LOCAL)).toBe(LOCAL);
  });
});
