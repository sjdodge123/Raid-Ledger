import {
  getSeriesIntervalMs,
  computeLeadTimeMs,
  computePostAt,
  shouldPostEmbed,
  getLeadTimeFromRecurrence,
} from './embed-lead-time';

describe('embed-lead-time utilities', () => {
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
    const sixDays = 6 * 24 * 60 * 60 * 1000;

    it('caps at 6 days for weekly interval', () => {
      const weekly = 7 * 24 * 60 * 60 * 1000;
      expect(computeLeadTimeMs(weekly)).toBe(sixDays);
    });

    it('caps at 6 days for biweekly interval', () => {
      const biweekly = 14 * 24 * 60 * 60 * 1000;
      expect(computeLeadTimeMs(biweekly)).toBe(sixDays);
    });

    it('caps at 6 days for monthly interval', () => {
      const monthly = 30 * 24 * 60 * 60 * 1000;
      expect(computeLeadTimeMs(monthly)).toBe(sixDays);
    });

    it('uses interval if shorter than 6 days', () => {
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      expect(computeLeadTimeMs(threeDays)).toBe(threeDays);
    });
  });

  describe('getLeadTimeFromRecurrence', () => {
    const sixDays = 6 * 24 * 60 * 60 * 1000;

    it('returns null for null recurrence rule', () => {
      expect(getLeadTimeFromRecurrence(null)).toBeNull();
    });

    it('returns null for undefined recurrence rule', () => {
      expect(getLeadTimeFromRecurrence(undefined)).toBeNull();
    });

    it('returns 6 days for weekly frequency', () => {
      expect(getLeadTimeFromRecurrence({ frequency: 'weekly' })).toBe(sixDays);
    });

    it('returns 6 days for biweekly frequency', () => {
      expect(getLeadTimeFromRecurrence({ frequency: 'biweekly' })).toBe(
        sixDays,
      );
    });

    it('returns 6 days for monthly frequency', () => {
      expect(getLeadTimeFromRecurrence({ frequency: 'monthly' })).toBe(sixDays);
    });
  });

  describe('computePostAt', () => {
    it('returns 1:00 PM UTC on the posting day for UTC timezone', () => {
      // Event at 2026-03-10 20:00 UTC, lead time = 6 days
      // Post day = 2026-03-04, post at 1:00 PM UTC
      const eventStart = '2026-03-10T20:00:00.000Z';
      const sixDays = 6 * 24 * 60 * 60 * 1000;
      const result = computePostAt(eventStart, sixDays, 'UTC');
      expect(result.toISOString()).toBe('2026-03-04T13:00:00.000Z');
    });

    it('adjusts for timezone offset (America/New_York)', () => {
      // Event at 2026-03-10 20:00 UTC, lead time = 6 days
      // Post day = 2026-03-04 in ET
      // March 4, 2026 — EST (UTC-5), so 1:00 PM ET = 18:00 UTC
      const eventStart = '2026-03-10T20:00:00.000Z';
      const sixDays = 6 * 24 * 60 * 60 * 1000;
      const result = computePostAt(eventStart, sixDays, 'America/New_York');
      expect(result.toISOString()).toBe('2026-03-04T18:00:00.000Z');
    });

    it('handles lead time shorter than 6 days', () => {
      // Event at 2026-03-10 20:00 UTC, lead time = 2 days
      // Post day = 2026-03-08, post at 1:00 PM UTC
      const eventStart = '2026-03-10T20:00:00.000Z';
      const twoDays = 2 * 24 * 60 * 60 * 1000;
      const result = computePostAt(eventStart, twoDays, 'UTC');
      expect(result.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    });
  });

  describe('shouldPostEmbed', () => {
    const sixDays = 6 * 24 * 60 * 60 * 1000;

    it('returns true when event is within lead time and past posting hour', () => {
      // Event starts in 3 days, "now" is past 1pm UTC
      const eventStart = '2026-03-10T20:00:00.000Z';
      const now = new Date('2026-03-07T15:00:00.000Z');
      expect(shouldPostEmbed(eventStart, sixDays, 'UTC', now)).toBe(true);
    });

    it('returns false when event is outside lead time window', () => {
      // Event starts in 10 days, lead time is 6 days
      const eventStart = '2026-03-17T20:00:00.000Z';
      const now = new Date('2026-03-07T15:00:00.000Z');
      expect(shouldPostEmbed(eventStart, sixDays, 'UTC', now)).toBe(false);
    });

    it('returns false for past events', () => {
      const eventStart = '2026-03-01T20:00:00.000Z';
      const now = new Date('2026-03-07T15:00:00.000Z');
      expect(shouldPostEmbed(eventStart, sixDays, 'UTC', now)).toBe(false);
    });

    it('returns false when within lead time but before posting hour', () => {
      // Event starts in 3 days, post day is today, but "now" is before 1pm
      const eventStart = '2026-03-10T20:00:00.000Z';
      // Post at = March 4 13:00 UTC. Now is March 4 10:00 UTC => before posting
      const now = new Date('2026-03-04T10:00:00.000Z');
      expect(shouldPostEmbed(eventStart, sixDays, 'UTC', now)).toBe(false);
    });

    it('returns true when exactly at posting time', () => {
      const eventStart = '2026-03-10T20:00:00.000Z';
      const now = new Date('2026-03-04T13:00:00.000Z');
      expect(shouldPostEmbed(eventStart, sixDays, 'UTC', now)).toBe(true);
    });

    it('returns true for standalone event starting tomorrow (within 6 days)', () => {
      const eventStart = '2026-03-08T20:00:00.000Z';
      const now = new Date('2026-03-07T14:00:00.000Z');
      expect(shouldPostEmbed(eventStart, sixDays, 'UTC', now)).toBe(true);
    });
  });

  describe('integration: 8-week weekly series', () => {
    const sixDays = 6 * 24 * 60 * 60 * 1000;

    it('only the first event is within lead time on creation day', () => {
      // Series created now: weekly events starting 2026-03-10, 03-17, 03-24, ...
      const now = new Date('2026-03-07T14:00:00.000Z');
      const events = [
        '2026-03-10T20:00:00.000Z', // 3 days away — within lead time
        '2026-03-17T20:00:00.000Z', // 10 days away — outside
        '2026-03-24T20:00:00.000Z', // 17 days away — outside
        '2026-03-31T20:00:00.000Z', // 24 days away — outside
        '2026-04-07T20:00:00.000Z',
        '2026-04-14T20:00:00.000Z',
        '2026-04-21T20:00:00.000Z',
        '2026-04-28T20:00:00.000Z',
      ];

      const results = events.map((start) =>
        shouldPostEmbed(start, sixDays, 'UTC', now),
      );

      // Only first event should post
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
});
