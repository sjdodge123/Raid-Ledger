/**
 * ROK-1616 AC3 — the `tonight` clock.
 *
 * Every case here is an INSTANT assertion in UTC, never a wall-clock string:
 * the whole bug class this helper exists to prevent is "04:00 local" quietly
 * becoming "04:00 on the server", so a test that reasoned in local strings
 * would be blind to exactly the failure it is guarding.
 *
 * `America/New_York` throughout because it is the zone whose DST transitions
 * are pinned by US federal law (second Sunday in March, first Sunday in
 * November) rather than by a tzdata release that could move under us.
 */
import { tonightExpiresAt } from './lfg-tonight.helpers';

const NY = 'America/New_York';
const HOUR_MS = 60 * 60 * 1000;

/** Hours between two instants — the unit every assertion below is stated in. */
function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

describe('tonightExpiresAt (ROK-1616 AC3)', () => {
  it('sends an evening hand to 04:00 the NEXT morning', () => {
    // 15:00 EDT (UTC-4) on 8 Sep 2026.
    const from = new Date('2026-09-08T19:00:00.000Z');

    const expires = tonightExpiresAt(from, NY);

    expect(expires.toISOString()).toBe('2026-09-09T08:00:00.000Z');
    expect(hoursBetween(from, expires)).toBe(13);
  });

  it('treats 01:00 as STILL TONIGHT — +3h, never +27h', () => {
    // 01:00 EDT on 8 Sep 2026: the small hours of the games night that
    // started on the 7th. Rolling this to the 9th would keep a hand alive a
    // whole extra day, which is the crux of AC3.
    const from = new Date('2026-09-08T05:00:00.000Z');

    const expires = tonightExpiresAt(from, NY);

    expect(expires.toISOString()).toBe('2026-09-08T08:00:00.000Z');
    expect(hoursBetween(from, expires)).toBe(3);
  });

  it('rolls forward at exactly 04:00 local, so a 4am hand gets a full night', () => {
    const from = new Date('2026-09-08T08:00:00.000Z'); // exactly 04:00 EDT

    const expires = tonightExpiresAt(from, NY);

    expect(expires.toISOString()).toBe('2026-09-09T08:00:00.000Z');
    expect(hoursBetween(from, expires)).toBe(24);
  });
});

describe('tonightExpiresAt — DST and zone handling (ROK-1616 AC3)', () => {
  it('crosses spring-forward: the night is one hour SHORTER in real time', () => {
    // 23:00 EST on 7 Mar 2026; clocks jump 02:00 -> 03:00 EDT on the 8th, so
    // 04:00 local arrives 4 real hours later, not 5.
    const from = new Date('2026-03-08T04:00:00.000Z');

    const expires = tonightExpiresAt(from, NY);

    expect(expires.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(hoursBetween(from, expires)).toBe(4);
  });

  it('crosses fall-back: the night is one hour LONGER in real time', () => {
    // 20:00 EDT on 31 Oct 2026; clocks repeat 01:00 EDT -> 01:00 EST on the
    // 1st, so 04:00 local arrives 9 real hours later, not 8.
    const from = new Date('2026-11-01T00:00:00.000Z');

    const expires = tonightExpiresAt(from, NY);

    expect(expires.toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(hoursBetween(from, expires)).toBe(9);
  });

  it('resolves a 01:00 hand raised INSIDE the repeated hour to the same morning', () => {
    // 01:30 EDT on 1 Nov 2026 — a wall clock that happens twice. Whichever
    // occurrence the player is living in, 04:00 is still later the same day.
    const from = new Date('2026-11-01T05:30:00.000Z');

    const expires = tonightExpiresAt(from, NY);

    expect(expires.toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(expires.getTime()).toBeGreaterThan(from.getTime());
  });

  it('uses the COMMUNITY zone, not UTC — the two disagree by hours', () => {
    const from = new Date('2026-09-08T19:00:00.000Z');

    expect(tonightExpiresAt(from, NY).toISOString()).not.toBe(
      tonightExpiresAt(from, 'UTC').toISOString(),
    );
    expect(tonightExpiresAt(from, 'UTC').toISOString()).toBe(
      '2026-09-09T04:00:00.000Z',
    );
  });

  it('falls back to the runtime zone on a junk timezone instead of throwing', () => {
    const from = new Date('2026-09-08T19:00:00.000Z');
    const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;

    for (const bad of ['Not/AZone', '', null, undefined]) {
      const expires = tonightExpiresAt(from, bad);
      expect(expires.getTime()).not.toBeNaN();
      expect(expires.toISOString()).toBe(
        tonightExpiresAt(from, runtime).toISOString(),
      );
    }
  });

  it('always lands strictly after `from`, and within one day of it', () => {
    const from = new Date('2026-09-08T19:00:00.000Z');

    for (const zone of [NY, 'UTC', 'Europe/Berlin', 'Australia/Lord_Howe']) {
      const expires = tonightExpiresAt(from, zone);
      expect(hoursBetween(from, expires)).toBeGreaterThan(0);
      expect(hoursBetween(from, expires)).toBeLessThanOrEqual(25);
    }
  });
});
