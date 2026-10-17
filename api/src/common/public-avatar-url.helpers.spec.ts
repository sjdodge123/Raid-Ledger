/**
 * ROK-1827 — an anonymous viewer gets no Discord-CDN avatar URL, because the
 * URL embeds the snowflake ROK-1629 set out to hide.
 */
import { publicAvatarUrl } from './public-avatar-url.helpers';

const SNOWFLAKE = '123456789012345678';

describe('publicAvatarUrl (ROK-1827)', () => {
  it('nulls a Discord avatar hash instead of building a CDN URL', () => {
    expect(publicAvatarUrl('abc123')).toBeNull();
  });

  it('passes an absolute custom avatar URL through unchanged', () => {
    const url = 'https://example.com/custom.png';
    expect(publicAvatarUrl(url)).toBe(url);
  });

  it('nulls a missing / empty avatar', () => {
    expect(publicAvatarUrl(null)).toBeNull();
    expect(publicAvatarUrl(undefined)).toBeNull();
    expect(publicAvatarUrl('')).toBeNull();
  });

  it('never returns a string containing a Discord snowflake for a hash input', () => {
    expect(publicAvatarUrl(SNOWFLAKE)).toBeNull();
    expect(String(publicAvatarUrl('hash1'))).not.toContain(SNOWFLAKE);
  });

  it('takes no Discord id parameter, so no caller can reintroduce one', () => {
    expect(publicAvatarUrl.length).toBe(1);
  });
});
