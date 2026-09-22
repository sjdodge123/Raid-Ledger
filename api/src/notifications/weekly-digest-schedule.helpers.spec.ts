import {
  DEFAULT_DIGEST_DAY,
  DEFAULT_DIGEST_HOUR,
  digestDedupKey,
  isDigestSlot,
  isoWeek,
  parseDigestSlot,
  resolveDigestChannel,
  safeTimeZone,
} from './weekly-digest-schedule.helpers';

const MONDAY_9 = { day: 1, hour: 9 };

describe('parseDigestSlot', () => {
  it('reads valid day and hour strings', () => {
    expect(parseDigestSlot('5', '23')).toEqual({ day: 5, hour: 23 });
    expect(parseDigestSlot('0', '0')).toEqual({ day: 0, hour: 0 });
  });

  it.each([
    [null, null],
    ['7', '24'],
    ['-1', '9.5'],
    ['mon', ''],
  ])('falls back to Monday 09:00 for (%p, %p)', (day, hour) => {
    expect(parseDigestSlot(day, hour)).toEqual({
      day: DEFAULT_DIGEST_DAY,
      hour: DEFAULT_DIGEST_HOUR,
    });
  });
});

describe('safeTimeZone', () => {
  it('keeps a real zone and replaces unset or bogus ones with UTC', () => {
    expect(safeTimeZone('America/New_York')).toBe('America/New_York');
    expect(safeTimeZone(null)).toBe('UTC');
    expect(safeTimeZone('Not/AZone')).toBe('UTC');
  });
});

describe('isDigestSlot', () => {
  it('matches the configured hour in UTC and not the hours either side', () => {
    expect(
      isDigestSlot(new Date('2026-09-21T09:05:00Z'), MONDAY_9, 'UTC'),
    ).toBe(true);
    expect(
      isDigestSlot(new Date('2026-09-21T09:59:59Z'), MONDAY_9, 'UTC'),
    ).toBe(true);
    expect(
      isDigestSlot(new Date('2026-09-21T08:59:59Z'), MONDAY_9, 'UTC'),
    ).toBe(false);
    expect(
      isDigestSlot(new Date('2026-09-21T10:00:00Z'), MONDAY_9, 'UTC'),
    ).toBe(false);
  });

  it('rejects the right hour on the wrong day', () => {
    expect(
      isDigestSlot(new Date('2026-09-22T09:05:00Z'), MONDAY_9, 'UTC'),
    ).toBe(false);
  });

  it('reads day and hour in the community timezone, not UTC', () => {
    // 13:05Z Monday = 09:05 EDT Monday.
    const at = new Date('2026-09-21T13:05:00Z');
    expect(isDigestSlot(at, MONDAY_9, 'America/New_York')).toBe(true);
    expect(isDigestSlot(at, MONDAY_9, 'UTC')).toBe(false);
  });

  it('crosses the date line: Sunday 23:05 local is Monday UTC', () => {
    // 04:05Z Monday = 23:05 CDT Sunday.
    const at = new Date('2026-09-21T04:05:00Z');
    expect(isDigestSlot(at, { day: 0, hour: 23 }, 'America/Chicago')).toBe(
      true,
    );
    expect(isDigestSlot(at, { day: 1, hour: 4 }, 'America/Chicago')).toBe(
      false,
    );
  });

  it('matches midnight as hour 0', () => {
    expect(
      isDigestSlot(
        new Date('2026-09-20T00:05:00Z'),
        { day: 0, hour: 0 },
        'UTC',
      ),
    ).toBe(true);
  });
});

describe('isoWeek / digestDedupKey', () => {
  it('formats the key as weekly-digest:<ISO-year>-W<week>', () => {
    expect(digestDedupKey(new Date('2026-09-21T09:05:00Z'), 'UTC')).toBe(
      'weekly-digest:2026-W39',
    );
    expect(digestDedupKey(new Date('2026-01-05T09:00:00Z'), 'UTC')).toBe(
      'weekly-digest:2026-W02',
    );
  });

  it('puts early-January days in the previous ISO year when ISO says so', () => {
    // 2027-01-01 is a Friday → ISO 2026-W53.
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'), 'UTC')).toEqual({
      year: 2026,
      week: 53,
    });
    // 2024-12-30 is a Monday → ISO 2025-W01.
    expect(isoWeek(new Date('2024-12-30T12:00:00Z'), 'UTC')).toEqual({
      year: 2025,
      week: 1,
    });
  });

  it('keeps Sunday in the same week as the Monday before it', () => {
    expect(digestDedupKey(new Date('2026-09-27T23:00:00Z'), 'UTC')).toBe(
      digestDedupKey(new Date('2026-09-21T00:00:00Z'), 'UTC'),
    );
  });

  it('uses the local date: Sunday night in Chicago is still last week', () => {
    const at = new Date('2026-09-28T03:00:00Z'); // Mon UTC, Sun 22:00 CDT
    expect(digestDedupKey(at, 'UTC')).toBe('weekly-digest:2026-W40');
    expect(digestDedupKey(at, 'America/Chicago')).toBe(
      'weekly-digest:2026-W39',
    );
  });
});

describe('resolveDigestChannel', () => {
  it('prefers the dedicated channel', () => {
    expect(resolveDigestChannel('111', '222')).toBe('111');
  });

  it('falls back to the default channel when the dedicated one is unset or blank', () => {
    expect(resolveDigestChannel(null, '222')).toBe('222');
    expect(resolveDigestChannel('  ', '222')).toBe('222');
  });

  it('returns null when neither is set', () => {
    expect(resolveDigestChannel(null, null)).toBeNull();
    expect(resolveDigestChannel('', ' ')).toBeNull();
  });
});
