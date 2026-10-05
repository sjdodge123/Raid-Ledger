import { discordAvatarUrl } from './discord-avatar-url.helpers';

describe('discordAvatarUrl (ROK-1629)', () => {
  it('builds the Discord CDN URL from a linked id + hash', () => {
    expect(discordAvatarUrl('123456789012345678', 'abc123')).toBe(
      'https://cdn.discordapp.com/avatars/123456789012345678/abc123.png',
    );
  });

  it('passes an absolute http(s) avatar through unchanged, even with no id', () => {
    const url = 'https://example.com/a.png';
    expect(discordAvatarUrl('123', url)).toBe(url);
    expect(discordAvatarUrl(null, url)).toBe(url);
    expect(discordAvatarUrl('local:bob', url)).toBe(url);
  });

  it('returns null when the hash is missing', () => {
    expect(discordAvatarUrl('123', null)).toBeNull();
    expect(discordAvatarUrl('123', undefined)).toBeNull();
    expect(discordAvatarUrl('123', '')).toBeNull();
  });

  it('returns null for a hash with no usable Discord id', () => {
    expect(discordAvatarUrl(null, 'abc')).toBeNull();
    expect(discordAvatarUrl('', 'abc')).toBeNull();
    expect(discordAvatarUrl('local:bob', 'abc')).toBeNull();
    expect(discordAvatarUrl('unlinked:bob', 'abc')).toBeNull();
  });
});
