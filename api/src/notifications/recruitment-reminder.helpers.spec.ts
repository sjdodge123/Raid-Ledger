import {
  calculateGracePeriodMs,
  isWithinGracePeriod,
  formatRelativeTimeLabel,
  isSameCalendarDay,
  isShortNoticeEvent,
  getShortNoticeThresholdHours,
  DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS,
} from './recruitment-reminder.helpers';

const HOUR = 60 * 60 * 1000;

describe('calculateGracePeriodMs', () => {
  it('should return 0 for events created >= 72h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-14T10:00:00Z'; // 96h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(0);
  });

  it('should return 0 at exactly 72h boundary', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-13T10:00:00Z'; // exactly 72h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(0);
  });

  it('should return 12h for events created 48-72h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-12T20:00:00Z'; // 58h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(12 * HOUR);
  });

  it('should return 12h at exactly 48h boundary', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-12T10:00:00Z'; // exactly 48h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(12 * HOUR);
  });

  it('should return 6h for events created 24-48h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-11T16:00:00Z'; // 30h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(6 * HOUR);
  });

  it('should return 6h at exactly 24h boundary', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-11T10:00:00Z'; // exactly 24h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(6 * HOUR);
  });

  it('should return 3h for events created 12-24h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-11T04:00:00Z'; // 18h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(3 * HOUR);
  });

  it('should return 3h at exactly 12h boundary', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-10T22:00:00Z'; // exactly 12h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(3 * HOUR);
  });

  it('should return 1h for events created < 12h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-10T20:00:00Z'; // 10h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(1 * HOUR);
  });

  it('should return 1h for events created 1h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-10T11:00:00Z'; // 1h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(1 * HOUR);
  });

  // Adversarial boundary tests: just below each tier threshold

  it('should return 12h for event created 71h59m59s before start (just below 72h)', () => {
    const createdAt = new Date('2026-03-10T10:00:00Z');
    const startTime = new Date(
      createdAt.getTime() + 72 * HOUR - 1000,
    ).toISOString();

    expect(calculateGracePeriodMs(createdAt.toISOString(), startTime)).toBe(
      12 * HOUR,
    );
  });

  it('should return 6h for event created 47h59m59s before start (just below 48h)', () => {
    const createdAt = new Date('2026-03-10T10:00:00Z');
    const startTime = new Date(
      createdAt.getTime() + 48 * HOUR - 1000,
    ).toISOString();

    expect(calculateGracePeriodMs(createdAt.toISOString(), startTime)).toBe(
      6 * HOUR,
    );
  });

  it('should return 3h for event created 23h59m59s before start (just below 24h)', () => {
    const createdAt = new Date('2026-03-10T10:00:00Z');
    const startTime = new Date(
      createdAt.getTime() + 24 * HOUR - 1000,
    ).toISOString();

    expect(calculateGracePeriodMs(createdAt.toISOString(), startTime)).toBe(
      3 * HOUR,
    );
  });

  it('should return 1h for event created 11h59m59s before start (just below 12h)', () => {
    const createdAt = new Date('2026-03-10T10:00:00Z');
    const startTime = new Date(
      createdAt.getTime() + 12 * HOUR - 1000,
    ).toISOString();

    expect(calculateGracePeriodMs(createdAt.toISOString(), startTime)).toBe(
      1 * HOUR,
    );
  });

  // Edge cases: createdAt at or after startTime

  it('should return 1h when createdAt equals startTime (event starts now)', () => {
    const ts = '2026-03-10T10:00:00Z';

    expect(calculateGracePeriodMs(ts, ts)).toBe(1 * HOUR);
  });

  it('should return 1h when createdAt is after startTime (clock skew / data anomaly)', () => {
    const createdAt = '2026-03-10T11:00:00Z';
    const startTime = '2026-03-10T10:00:00Z'; // start is in the past relative to creation

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(1 * HOUR);
  });
});

/** Helper to build a minimal EligibleEvent for isWithinGracePeriod tests. */
function makeGraceEvent(createdAt: string, startTime: string) {
  return {
    id: 1,
    title: 'Test',
    gameId: 1,
    gameName: 'Test',
    creatorId: 1,
    startTime,
    maxAttendees: null,
    signupCount: 0,
    channelId: 'ch',
    guildId: 'g',
    messageId: 'm',
    createdAt,
    recurrenceGroupId: null,
    notificationChannelOverride: null,
  };
}

describe('isWithinGracePeriod', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return false when event was created >= 72h before start (no grace)', () => {
    jest.setSystemTime(new Date('2026-03-10T10:05:00Z'));
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-14T10:00:00Z',
    );

    expect(isWithinGracePeriod(event)).toBe(false);
  });

  it('should return true when within grace period (24-48h tier, < 6h since creation)', () => {
    jest.setSystemTime(new Date('2026-03-10T12:00:00Z')); // 2h after creation
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-11T16:00:00Z',
    );

    expect(isWithinGracePeriod(event)).toBe(true);
  });

  it('should return false when grace period has elapsed', () => {
    jest.setSystemTime(new Date('2026-03-10T17:00:00Z')); // 7h after creation
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-11T16:00:00Z',
    );

    expect(isWithinGracePeriod(event)).toBe(false);
  });

  // Adversarial: grace-boundary precision

  it('should return true 1ms before grace period ends (24-48h tier, 6h grace)', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-11T16:00:00Z'; // 30h gap → 6h grace
    const graceExpiryMs = new Date(createdAt).getTime() + 6 * HOUR;

    jest.setSystemTime(new Date(graceExpiryMs - 1)); // 1ms before grace expires

    expect(isWithinGracePeriod(makeGraceEvent(createdAt, startTime))).toBe(
      true,
    );
  });

  it('should return false exactly at grace expiry (24-48h tier, 6h grace)', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-11T16:00:00Z'; // 30h gap → 6h grace
    const graceExpiryMs = new Date(createdAt).getTime() + 6 * HOUR;

    jest.setSystemTime(new Date(graceExpiryMs)); // exactly at grace expiry

    expect(isWithinGracePeriod(makeGraceEvent(createdAt, startTime))).toBe(
      false,
    );
  });

  it('should return false for event created well in past (>72h before start) regardless of current time', () => {
    // Even if we set time just 1min after creation, no grace applies for >72h events
    jest.setSystemTime(new Date('2026-03-10T10:01:00Z')); // 1min after creation
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-14T10:00:00Z', // 96h ahead — >72h → grace = 0
    );

    expect(isWithinGracePeriod(event)).toBe(false);
  });

  // ROK-1240: events with start_time - created_at < 12h are now suppressed
  // entirely (short-notice rule). The historical "1h grace" tier is no
  // longer reachable from `isWithinGracePeriod`, but `calculateGracePeriodMs`
  // still returns 1h for that band since callers other than this gate may
  // care about the raw tier.

  it('should return true 30min after creation for event starting 10h later (short-notice suppression)', () => {
    jest.setSystemTime(new Date('2026-03-10T10:30:00Z')); // 30min after creation
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-10T20:00:00Z', // 10h gap → short-notice → SUPPRESSED
    );

    expect(isWithinGracePeriod(event)).toBe(true);
  });

  it('should STILL return true 90min after creation for event starting 10h later (short-notice — historical 1h grace no longer applies)', () => {
    jest.setSystemTime(new Date('2026-03-10T11:30:00Z')); // 90min after creation
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-10T20:00:00Z', // 10h gap → short-notice → SUPPRESSED regardless of elapsed time
    );

    expect(isWithinGracePeriod(event)).toBe(true);
  });

  it('should return true for event where createdAt is after startTime (short-notice — clock skew → suppressed)', () => {
    jest.setSystemTime(new Date('2026-03-10T11:00:00Z'));
    // createdAt > startTime — negative timeUntilEvent → short-notice → suppressed.
    const event = makeGraceEvent(
      '2026-03-10T11:00:00Z', // createdAt
      '2026-03-10T10:00:00Z', // startTime is before createdAt
    );

    expect(isWithinGracePeriod(event)).toBe(true);
  });

  it('should use explicit now parameter instead of Date.now() when provided', () => {
    // Do NOT set fake timers to a specific time — the explicit `now` param should win
    jest.setSystemTime(new Date('2099-01-01T00:00:00Z')); // far in future (grace would be expired)
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-11T16:00:00Z', // 30h gap → 6h grace
    );
    // Pass an explicit now within the grace period (2h after creation)
    const explicitNow = new Date('2026-03-10T12:00:00Z').getTime();

    expect(isWithinGracePeriod(event, explicitNow)).toBe(true);
  });

  // ROK-1240 — short-notice suppression block

  describe('short-notice suppression (ROK-1240)', () => {
    it('should suppress (return true) when start - created < 12h, regardless of elapsed time', () => {
      // Event created 8h before start, cron runs 7h after creation (1h to start)
      const createdAt = '2026-03-10T10:00:00Z';
      const startTime = '2026-03-10T18:00:00Z'; // 8h gap (< 12h threshold)
      jest.setSystemTime(new Date('2026-03-10T17:00:00Z'));

      expect(isWithinGracePeriod(makeGraceEvent(createdAt, startTime))).toBe(
        true,
      );
    });

    it('should NOT suppress (return false) when start - created >= 12h and grace elapsed', () => {
      const createdAt = '2026-03-10T10:00:00Z';
      const startTime = '2026-03-10T22:00:00Z'; // exactly 12h gap → tier=3h grace, NOT short-notice
      jest.setSystemTime(new Date('2026-03-10T17:00:00Z')); // 7h after creation, > 3h grace

      expect(isWithinGracePeriod(makeGraceEvent(createdAt, startTime))).toBe(
        false,
      );
    });

    it('should suppress at exactly threshold - 1ms (start - created = 12h - 1ms)', () => {
      const createdAt = new Date('2026-03-10T10:00:00Z');
      const startTime = new Date(createdAt.getTime() + 12 * HOUR - 1);
      jest.setSystemTime(new Date(createdAt.getTime() + 11 * HOUR));

      expect(
        isWithinGracePeriod(
          makeGraceEvent(createdAt.toISOString(), startTime.toISOString()),
        ),
      ).toBe(true);
    });
  });
});

describe('isShortNoticeEvent (ROK-1240)', () => {
  it('returns true when start - created < 12h (default)', () => {
    expect(
      isShortNoticeEvent({
        createdAt: '2026-03-10T10:00:00Z',
        startTime: '2026-03-10T20:00:00Z', // 10h gap
      }),
    ).toBe(true);
  });

  it('returns false at exactly threshold (12h)', () => {
    expect(
      isShortNoticeEvent({
        createdAt: '2026-03-10T10:00:00Z',
        startTime: '2026-03-10T22:00:00Z', // exactly 12h
      }),
    ).toBe(false);
  });

  it('returns false when start - created > 12h', () => {
    expect(
      isShortNoticeEvent({
        createdAt: '2026-03-10T10:00:00Z',
        startTime: '2026-03-11T16:00:00Z', // 30h gap
      }),
    ).toBe(false);
  });

  it('returns true when start <= created (clock skew / data anomaly)', () => {
    expect(
      isShortNoticeEvent({
        createdAt: '2026-03-10T11:00:00Z',
        startTime: '2026-03-10T10:00:00Z', // start before creation
      }),
    ).toBe(true);
  });

  it('honours explicit thresholdHours override', () => {
    // 10h gap, threshold 6 → not short-notice
    expect(
      isShortNoticeEvent(
        {
          createdAt: '2026-03-10T10:00:00Z',
          startTime: '2026-03-10T20:00:00Z',
        },
        6,
      ),
    ).toBe(false);
    // 10h gap, threshold 24 → short-notice
    expect(
      isShortNoticeEvent(
        {
          createdAt: '2026-03-10T10:00:00Z',
          startTime: '2026-03-10T20:00:00Z',
        },
        24,
      ),
    ).toBe(true);
  });
});

describe('getShortNoticeThresholdHours (ROK-1240)', () => {
  const ENV_KEY = 'RECRUITMENT_SHORT_NOTICE_HOURS';
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('returns the default when env var is unset', () => {
    delete process.env[ENV_KEY];
    expect(getShortNoticeThresholdHours()).toBe(
      DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS,
    );
  });

  it('returns env value when valid positive number', () => {
    process.env[ENV_KEY] = '6';
    expect(getShortNoticeThresholdHours()).toBe(6);
  });

  it('falls back to default when env value is 0', () => {
    process.env[ENV_KEY] = '0';
    expect(getShortNoticeThresholdHours()).toBe(
      DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS,
    );
  });

  it('falls back to default when env value is negative', () => {
    process.env[ENV_KEY] = '-4';
    expect(getShortNoticeThresholdHours()).toBe(
      DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS,
    );
  });

  it('falls back to default when env value is non-numeric', () => {
    process.env[ENV_KEY] = 'banana';
    expect(getShortNoticeThresholdHours()).toBe(
      DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS,
    );
  });
});

describe('isSameCalendarDay (ROK-1240)', () => {
  it('returns true for two timestamps on the same UTC day', () => {
    expect(
      isSameCalendarDay(
        new Date('2026-05-10T01:00:00Z'),
        new Date('2026-05-10T23:00:00Z'),
        'UTC',
      ),
    ).toBe(true);
  });

  it('returns false for two timestamps on different UTC days', () => {
    expect(
      isSameCalendarDay(
        new Date('2026-05-10T23:00:00Z'),
        new Date('2026-05-11T01:00:00Z'),
        'UTC',
      ),
    ).toBe(false);
  });

  it('respects America/New_York calendar boundary (DST-safe pin)', () => {
    // 2026-06-10T03:00:00Z = 2026-06-09 23:00 EDT (UTC-4)
    // 2026-06-10T05:00:00Z = 2026-06-10 01:00 EDT
    // In NY they straddle midnight → different days
    expect(
      isSameCalendarDay(
        new Date('2026-06-10T03:00:00Z'),
        new Date('2026-06-10T05:00:00Z'),
        'America/New_York',
      ),
    ).toBe(false);
    // Same UTC moments in UTC tz → same calendar day
    expect(
      isSameCalendarDay(
        new Date('2026-06-10T03:00:00Z'),
        new Date('2026-06-10T05:00:00Z'),
        'UTC',
      ),
    ).toBe(true);
  });

  it('returns true at exactly midnight boundary (same instant)', () => {
    const ts = new Date('2026-05-10T00:00:00Z');
    expect(isSameCalendarDay(ts, ts, 'UTC')).toBe(true);
  });
});

describe('formatRelativeTimeLabel (ROK-1240)', () => {
  // Pin to an arbitrary non-DST UTC date for boundary deterministic results.

  it('returns "today" for an event scheduled at 11:59 PM tonight', () => {
    // now = 2026-03-10 09:00 UTC, start = 2026-03-10 23:59 UTC
    const now = new Date('2026-03-10T09:00:00Z').getTime();
    const start = '2026-03-10T23:59:00Z';
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('today');
  });

  it('returns "tomorrow" for an event at 12:00 AM tomorrow', () => {
    const now = new Date('2026-03-10T09:00:00Z').getTime();
    const start = '2026-03-11T00:00:00Z'; // 15h ahead, next calendar day
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('tomorrow');
  });

  it('returns "tomorrow" for an event at 1 AM tomorrow', () => {
    const now = new Date('2026-03-10T09:00:00Z').getTime();
    const start = '2026-03-11T01:00:00Z'; // 16h ahead, next calendar day
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('tomorrow');
  });

  it('returns "today" for scheduled-noon-processed-9am scenario (Gamer Saloon recurrence)', () => {
    // The exact failure case from the bug report (5/10 3pm reminder for
    // 5/10 9pm event), translated to deterministic UTC.
    // now = 2026-05-10 15:00 UTC, event = 2026-05-10 21:00 UTC (6h out, same day)
    const now = new Date('2026-05-10T15:00:00Z').getTime();
    const start = '2026-05-10T21:00:00Z';
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('today');
  });

  it('returns "tomorrow" when event crosses midnight into next day, < 24h out', () => {
    // now = 2026-03-10 22:00 UTC, event = 2026-03-11 02:00 UTC
    // 4h ahead but next calendar day → "tomorrow"
    const now = new Date('2026-03-10T22:00:00Z').getTime();
    const start = '2026-03-11T02:00:00Z';
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('tomorrow');
  });

  it('returns "now" when start is in the past', () => {
    const now = new Date('2026-03-10T12:00:00Z').getTime();
    const start = '2026-03-10T11:00:00Z';
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('now');
  });

  it('returns "now" when start is exactly equal to now', () => {
    const now = new Date('2026-03-10T12:00:00Z').getTime();
    expect(formatRelativeTimeLabel(new Date(now), now, 'UTC')).toBe('now');
  });

  it('returns "in Xh" when start is more than 24h out', () => {
    const now = new Date('2026-03-10T10:00:00Z').getTime();
    const start = '2026-03-11T22:00:00Z'; // 36h out
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('in 36h');
  });

  it('returns "tomorrow" when hoursUntil rounds to 24 and start is on next calendar day', () => {
    // 23h59m out, but next calendar day → tomorrow (rounds to 24)
    const now = new Date('2026-03-10T10:00:00Z').getTime();
    const start = '2026-03-11T09:59:00Z';
    // hoursUntil = round(23.98...) = 24 → falls into "<= 24" branch with
    // not-same-day → "tomorrow"
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('tomorrow');
  });

  it('respects timezone for "today" boundary (NYC same-day vs UTC next-day)', () => {
    // now = 2026-06-10 22:00 EDT = 2026-06-11 02:00 UTC
    // start = 2026-06-10 23:30 EDT = 2026-06-11 03:30 UTC
    // In NY: same calendar day (2026-06-10) → "today"
    // In UTC: same day (2026-06-11) → also "today"
    const now = new Date('2026-06-11T02:00:00Z').getTime();
    const start = '2026-06-11T03:30:00Z';
    expect(formatRelativeTimeLabel(start, now, 'America/New_York')).toBe(
      'today',
    );
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('today');
  });

  it('respects timezone for "today" boundary (NY same-day, UTC next-day across midnight)', () => {
    // start = 2026-06-11 03:30 UTC = 2026-06-10 23:30 EDT (today in NY)
    // now = 2026-06-10 23:00 UTC = 2026-06-10 19:00 EDT (today in NY, today in UTC)
    // In NY: same calendar day (2026-06-10) → "today"
    // In UTC: now is 2026-06-10, start is 2026-06-11 → "tomorrow"
    const now = new Date('2026-06-10T23:00:00Z').getTime();
    const start = '2026-06-11T03:30:00Z'; // 4.5h ahead
    expect(formatRelativeTimeLabel(start, now, 'America/New_York')).toBe(
      'today',
    );
    expect(formatRelativeTimeLabel(start, now, 'UTC')).toBe('tomorrow');
  });
});
