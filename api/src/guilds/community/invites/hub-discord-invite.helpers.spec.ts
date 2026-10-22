import {
  EXPIRY_MARGIN_MS,
  inviteCacheTtlMs,
  MAX_CACHE_MS,
} from './hub-discord-invite.helpers';

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const HOUR = 3_600_000;
const at = (msFromNow: number): Date => new Date(NOW + msFromNow);

describe('inviteCacheTtlMs (ROK-1893 P1 §8d)', () => {
  it('a fresh 24h invite is cached for the 23h cap', () => {
    expect(inviteCacheTtlMs(at(24 * HOUR), NOW)).toBe(MAX_CACHE_MS);
  });

  it('a reused invite with 3h left is cached until 1h before it expires', () => {
    expect(inviteCacheTtlMs(at(3 * HOUR), NOW)).toBe(
      3 * HOUR - EXPIRY_MARGIN_MS,
    );
  });

  it('a reused invite inside the safety margin is not cached at all', () => {
    expect(inviteCacheTtlMs(at(30 * 60_000), NOW)).toBe(0);
  });

  it('an already-expired invite is not cached', () => {
    expect(inviteCacheTtlMs(at(-HOUR), NOW)).toBe(0);
  });

  it('a never-expiring invite (expiresAt null) is cached for the cap', () => {
    expect(inviteCacheTtlMs(null, NOW)).toBe(MAX_CACHE_MS);
  });
});
