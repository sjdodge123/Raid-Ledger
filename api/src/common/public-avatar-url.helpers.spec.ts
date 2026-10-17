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

  it('nulls an absolute Discord-CDN avatar URL stored on the row', () => {
    expect(
      publicAvatarUrl(
        `https://cdn.discordapp.com/avatars/${SNOWFLAKE}/hash1.png`,
      ),
    ).toBeNull();
    expect(
      publicAvatarUrl(
        `https://media.discordapp.net/avatars/${SNOWFLAKE}/hash1.png?size=64`,
      ),
    ).toBeNull();
    expect(
      publicAvatarUrl(`https://example.com/avatars/${SNOWFLAKE}.png`),
    ).toBeNull();
  });

  it('still passes a non-Discord absolute URL through unchanged', () => {
    const url = 'https://cdn.example.com/uploads/u/42/portrait.webp';
    expect(publicAvatarUrl(url)).toBe(url);
  });

  it('nulls a string that starts with http but is not a parsable URL', () => {
    expect(publicAvatarUrl('httpnonsense')).toBeNull();
  });

  it('nulls the Codex-found bypasses: trailing-dot host, encoded path, odd scheme', () => {
    expect(
      publicAvatarUrl('https://cdn.discordapp.com./avatars/123/hash.png'),
    ).toBeNull();
    expect(
      publicAvatarUrl('https://example.com/%61vatars/123/hash.png'),
    ).toBeNull();
    expect(publicAvatarUrl('httpx://example.com/photo.png')).toBeNull();
    expect(publicAvatarUrl('https://example.com/AVATARS/1/h.png')).toBeNull();
  });

  it('accepts an upper-case http(s) scheme as a custom URL', () => {
    const url = 'HTTP://example.com/photo.png';
    expect(publicAvatarUrl(url)).toBe(url);
  });

  it('takes no Discord id parameter, so no caller can reintroduce one', () => {
    expect(publicAvatarUrl.length).toBe(1);
  });
});
