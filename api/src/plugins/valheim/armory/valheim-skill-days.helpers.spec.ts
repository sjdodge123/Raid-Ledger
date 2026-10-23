/** ROK-1882 — play-day bucketing (fixed instants, no wall clock). */
import {
  isValidTimeZone,
  playDateIn,
  resolvePlayTimezone,
} from './valheim-skill-days.helpers';

const AT = new Date('2026-10-21T03:00:00Z');

describe('valheim skill play-day helpers', () => {
  it('buckets an instant by the calendar date in the given zone', () => {
    expect(playDateIn(AT, 'UTC')).toBe('2026-10-21');
    expect(playDateIn(AT, 'America/New_York')).toBe('2026-10-20');
    expect(playDateIn(AT, 'Asia/Tokyo')).toBe('2026-10-21');
  });

  it('prefers the server zone, then the community default, then UTC', () => {
    expect(resolvePlayTimezone('Europe/Oslo', 'America/New_York')).toBe(
      'Europe/Oslo',
    );
    expect(resolvePlayTimezone(null, 'America/New_York')).toBe(
      'America/New_York',
    );
    expect(resolvePlayTimezone(null, null)).toBe('UTC');
  });

  it('skips an invalid zone rather than throwing', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(resolvePlayTimezone('Not/AZone', 'Bad/Zone')).toBe('UTC');
  });
});
