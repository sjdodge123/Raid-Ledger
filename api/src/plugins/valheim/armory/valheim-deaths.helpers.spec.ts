import { deathOccurredAt, zonedLocalToUtc } from './valheim-deaths.helpers';

describe('zonedLocalToUtc (ROK-1930)', () => {
  it('reads a wall-clock time in UTC as itself', () => {
    expect(zonedLocalToUtc('2026-10-15T10:00:05', 'UTC')?.toISOString()).toBe(
      '2026-10-15T10:00:05.000Z',
    );
  });

  it('applies the zone offset (New York, EDT = UTC-4)', () => {
    expect(
      zonedLocalToUtc('2026-10-15T10:00:05', 'America/New_York')?.toISOString(),
    ).toBe('2026-10-15T14:00:05.000Z');
  });

  it('applies the winter offset (New York, EST = UTC-5)', () => {
    expect(
      zonedLocalToUtc('2026-01-15T10:00:05', 'America/New_York')?.toISOString(),
    ).toBe('2026-01-15T15:00:05.000Z');
  });

  it('is null for a string that is not yyyy-MM-ddTHH:mm:ss', () => {
    expect(zonedLocalToUtc('10/15/2026 10:00:05', 'UTC')).toBeNull();
  });
});

describe('deathOccurredAt (ROK-1930 review fix 1)', () => {
  // A UTC container receives a New York server's 10:00:05 line at 10:00:06Z.
  const received = new Date('2026-10-15T10:00:06.000Z');

  it('clamps a future-dated zoned read to the receive time', () => {
    expect(
      deathOccurredAt(
        '2026-10-15T10:00:05',
        'America/New_York',
        received,
      ).toISOString(),
    ).toBe('2026-10-15T10:00:06.000Z');
  });

  it('keeps a zoned read that is in the past (a cold replay of an old line)', () => {
    expect(
      deathOccurredAt(
        '2026-10-14T10:00:05',
        'America/New_York',
        received,
      ).toISOString(),
    ).toBe('2026-10-14T14:00:05.000Z');
  });

  it('falls back to the receive time for an unparseable stamp', () => {
    expect(deathOccurredAt('garbage', 'UTC', received)).toBe(received);
  });
});
