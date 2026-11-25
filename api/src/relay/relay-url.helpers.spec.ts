import {
  DEFAULT_RELAY_URL,
  parseRelayHubEnv,
  resolveRelayUrl,
} from './relay-url.helpers';

describe('parseRelayHubEnv (ROK-1676 AC 1)', () => {
  it('reads an http URL, trimmed, with trailing slashes stripped', () => {
    expect(parseRelayHubEnv('  http://192.168.0.10:3600//  ')).toEqual({
      kind: 'valid',
      url: 'http://192.168.0.10:3600',
    });
  });

  it('accepts https', () => {
    expect(parseRelayHubEnv('https://hub.example.com')).toEqual({
      kind: 'valid',
      url: 'https://hub.example.com',
    });
  });

  it.each([undefined, '', '   '])('treats %p as unset', (raw) => {
    expect(parseRelayHubEnv(raw)).toEqual({ kind: 'unset' });
  });

  it.each(['ftp://hub.example.com', 'not a url', 'javascript:alert(1)'])(
    'marks %p invalid',
    (raw) => {
      expect(parseRelayHubEnv(raw)).toEqual({ kind: 'invalid', raw });
    },
  );
});

describe('resolveRelayUrl (ROK-1676 AC 1)', () => {
  const env = parseRelayHubEnv('http://192.168.0.10:3600');

  it('prefers the env URL over the setting', () => {
    expect(resolveRelayUrl(env, 'https://other.example.com')).toBe(
      'http://192.168.0.10:3600',
    );
  });

  it('falls back to the setting when the env is unset', () => {
    expect(
      resolveRelayUrl({ kind: 'unset' }, 'https://other.example.com'),
    ).toBe('https://other.example.com');
  });

  it('ignores an invalid env value', () => {
    expect(
      resolveRelayUrl({ kind: 'invalid', raw: 'x' }, 'https://s.example.com'),
    ).toBe('https://s.example.com');
  });

  it('falls back to the built-in default when neither is set', () => {
    expect(resolveRelayUrl({ kind: 'unset' }, null)).toBe(DEFAULT_RELAY_URL);
    expect(resolveRelayUrl({ kind: 'unset' }, '')).toBe(DEFAULT_RELAY_URL);
  });
});
