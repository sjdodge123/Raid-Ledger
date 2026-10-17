import {
  getSeriesIntervalMs,
  computeLeadTimeMs,
  computePostAt,
  shouldPostEmbed,
  getLeadTimeFromRecurrence,
} from './embed-lead-time';

const SIX_DAYS = 6 * 24 * 60 * 60 * 1000;

describe('getSeriesIntervalMs', () => {
  it('returns 7 days for weekly', () => {
    expect(getSeriesIntervalMs('weekly')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('returns 14 days for biweekly', () => {
    expect(getSeriesIntervalMs('biweekly')).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('returns 30 days for monthly', () => {
    expect(getSeriesIntervalMs('monthly')).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('computeLeadTimeMs', () => {
  it('caps at 6 days for weekly interval', () => {
    const weekly = 7 * 24 * 60 * 60 * 1000;
    expect(computeLeadTimeMs(weekly)).toBe(SIX_DAYS);
  });

  it('caps at 6 days for biweekly interval', () => {
    const biweekly = 14 * 24 * 60 * 60 * 1000;
    expect(computeLeadTimeMs(biweekly)).toBe(SIX_DAYS);
  });

  it('caps at 6 days for monthly interval', () => {
    const monthly = 30 * 24 * 60 * 60 * 1000;
    expect(computeLeadTimeMs(monthly)).toBe(SIX_DAYS);
  });

  it('uses interval if shorter than 6 days', () => {
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    expect(computeLeadTimeMs(threeDays)).toBe(threeDays);
  });
});

describe('getLeadTimeFromRecurrence', () => {
  it('returns null for null recurrence rule', () => {
    expect(getLeadTimeFromRecurrence(null)).toBeNull();
  });

  it('returns null for undefined recurrence rule', () => {
    expect(getLeadTimeFromRecurrence(undefined)).toBeNull();
  });

  it('returns 6 days for weekly frequency', () => {
    expect(getLeadTimeFromRecurrence({ frequency: 'weekly' })).toBe(SIX_DAYS);
  });

  it('returns 6 days for biweekly frequency', () => {
    expect(getLeadTimeFromRecurrence({ frequency: 'biweekly' })).toBe(SIX_DAYS);
  });

  it('returns 6 days for monthly frequency', () => {
    expect(getLeadTimeFromRecurrence({ frequency: 'monthly' })).toBe(SIX_DAYS);
  });
});

describe('computePostAt', () => {
  it('returns 1:00 PM UTC on the posting day for UTC timezone', () => {
    const eventStart = '2026-03-10T20:00:00.000Z';
    const result = computePostAt(eventStart, SIX_DAYS, 'UTC');
    expect(result.toISOString()).toBe('2026-03-04T13:00:00.000Z');
  });

  it('adjusts for timezone offset (America/New_York)', () => {
    const eventStart = '2026-03-10T20:00:00.000Z';
    const result = computePostAt(eventStart, SIX_DAYS, 'America/New_York');
    expect(result.toISOString()).toBe('2026-03-04T18:00:00.000Z');
  });

  it('handles lead time shorter than 6 days', () => {
    const eventStart = '2026-03-10T20:00:00.000Z';
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    const result = computePostAt(eventStart, twoDays, 'UTC');
    expect(result.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });
});

describe('shouldPostEmbed', () => {
  it('returns true when event is within lead time and past posting hour', () => {
    const eventStart = '2026-03-10T20:00:00.000Z';
    const now = new Date('2026-03-07T15:00:00.000Z');
    expect(shouldPostEmbed(eventStart, SIX_DAYS, 'UTC', now)).toBe(true);
  });

  it('returns false when event is outside lead time window', () => {
    const eventStart = '2026-03-17T20:00:00.000Z';
    const now = new Date('2026-03-07T15:00:00.000Z');
    expect(shouldPostEmbed(eventStart, SIX_DAYS, 'UTC', now)).toBe(false);
  });

  it('returns false for past events', () => {
    const eventStart = '2026-03-01T20:00:00.000Z';
    const now = new Date('2026-03-07T15:00:00.000Z');
    expect(shouldPostEmbed(eventStart, SIX_DAYS, 'UTC', now)).toBe(false);
  });

  it('returns false when within lead time but before posting hour', () => {
    const eventStart = '2026-03-10T20:00:00.000Z';
    const now = new Date('2026-03-04T10:00:00.000Z');
    expect(shouldPostEmbed(eventStart, SIX_DAYS, 'UTC', now)).toBe(false);
  });

  it('returns true when exactly at posting time', () => {
    const eventStart = '2026-03-10T20:00:00.000Z';
    const now = new Date('2026-03-04T13:00:00.000Z');
    expect(shouldPostEmbed(eventStart, SIX_DAYS, 'UTC', now)).toBe(true);
  });

  it('returns true for standalone event starting tomorrow (within 6 days)', () => {
    const eventStart = '2026-03-08T20:00:00.000Z';
    const now = new Date('2026-03-07T14:00:00.000Z');
    expect(shouldPostEmbed(eventStart, SIX_DAYS, 'UTC', now)).toBe(true);
  });
});

describe('shouldPostEmbed — 8-week weekly series integration', () => {
  it('only the first event is within lead time on creation day', () => {
    const now = new Date('2026-03-07T14:00:00.000Z');
    const events = [
      '2026-03-10T20:00:00.000Z',
      '2026-03-17T20:00:00.000Z',
      '2026-03-24T20:00:00.000Z',
      '2026-03-31T20:00:00.000Z',
      '2026-04-07T20:00:00.000Z',
      '2026-04-14T20:00:00.000Z',
      '2026-04-21T20:00:00.000Z',
      '2026-04-28T20:00:00.000Z',
    ];

    const results = events.map((start) =>
      shouldPostEmbed(start, SIX_DAYS, 'UTC', now),
    );

    expect(results).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
