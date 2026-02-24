/**
 * Unit tests for generateRecurringDates() (ROK-422).
 *
 * Covers all three frequencies (weekly, biweekly, monthly), edge cases
 * (month-end clamping, DST boundaries, short/long ranges), and the
 * instance cap.
 */
import {
  generateRecurringDates,
  MAX_RECURRENCE_INSTANCES,
} from './recurrence.util';

// Helper: create UTC date from ISO string
const utc = (iso: string) => new Date(iso);

describe('generateRecurringDates', () => {
  // ─── Weekly ────────────────────────────────────────────────────────────

  describe('weekly frequency', () => {
    it('generates correct weekly dates', () => {
      const start = utc('2026-03-01T19:00:00Z');
      const until = utc('2026-03-29T23:59:59Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(5); // Mar 1, 8, 15, 22, 29
      expect(dates[0].toISOString()).toBe('2026-03-01T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-03-08T19:00:00.000Z');
      expect(dates[2].toISOString()).toBe('2026-03-15T19:00:00.000Z');
      expect(dates[3].toISOString()).toBe('2026-03-22T19:00:00.000Z');
      expect(dates[4].toISOString()).toBe('2026-03-29T19:00:00.000Z');
    });

    it('stops when next occurrence exceeds until', () => {
      const start = utc('2026-03-01T19:00:00Z');
      const until = utc('2026-03-10T23:59:59Z'); // only 1 week fits
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(2); // Mar 1, Mar 8
    });

    it('returns only the start date when until is before the next occurrence', () => {
      const start = utc('2026-03-01T19:00:00Z');
      const until = utc('2026-03-05T23:59:59Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(1);
      expect(dates[0].toISOString()).toBe('2026-03-01T19:00:00.000Z');
    });
  });

  // ─── Biweekly ──────────────────────────────────────────────────────────

  describe('biweekly frequency', () => {
    it('generates correct biweekly dates', () => {
      const start = utc('2026-01-05T20:00:00Z');
      const until = utc('2026-03-02T23:59:59Z');
      const dates = generateRecurringDates(start, 'biweekly', until);

      expect(dates).toHaveLength(5); // Jan 5, 19, Feb 2, 16, Mar 2
      expect(dates[0].toISOString()).toBe('2026-01-05T20:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-01-19T20:00:00.000Z');
      expect(dates[2].toISOString()).toBe('2026-02-02T20:00:00.000Z');
      expect(dates[3].toISOString()).toBe('2026-02-16T20:00:00.000Z');
      expect(dates[4].toISOString()).toBe('2026-03-02T20:00:00.000Z');
    });
  });

  // ─── Monthly ───────────────────────────────────────────────────────────

  describe('monthly frequency', () => {
    it('generates correct monthly dates for a mid-month day', () => {
      const start = utc('2026-01-15T19:00:00Z');
      const until = utc('2026-04-15T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(4); // Jan 15, Feb 15, Mar 15, Apr 15
      expect(dates[0].toISOString()).toBe('2026-01-15T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-02-15T19:00:00.000Z');
      expect(dates[2].toISOString()).toBe('2026-03-15T19:00:00.000Z');
      expect(dates[3].toISOString()).toBe('2026-04-15T19:00:00.000Z');
    });

    it('clamps Jan 31 -> Feb 28 (non-leap year) and recovers to Mar 31', () => {
      // 2026 is not a leap year
      const start = utc('2026-01-31T19:00:00Z');
      const until = utc('2026-05-31T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(5);
      expect(dates[0].toISOString()).toBe('2026-01-31T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-02-28T19:00:00.000Z'); // clamped
      expect(dates[2].toISOString()).toBe('2026-03-31T19:00:00.000Z'); // recovered
      expect(dates[3].toISOString()).toBe('2026-04-30T19:00:00.000Z'); // clamped (Apr has 30 days)
      expect(dates[4].toISOString()).toBe('2026-05-31T19:00:00.000Z'); // recovered
    });

    it('clamps Jan 31 -> Feb 29 (leap year)', () => {
      // 2028 is a leap year
      const start = utc('2028-01-31T19:00:00Z');
      const until = utc('2028-03-31T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(3);
      expect(dates[0].toISOString()).toBe('2028-01-31T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2028-02-29T19:00:00.000Z'); // leap day
      expect(dates[2].toISOString()).toBe('2028-03-31T19:00:00.000Z'); // recovered
    });

    it('handles Jan 30 -> Feb 28 -> Mar 30', () => {
      const start = utc('2026-01-30T19:00:00Z');
      const until = utc('2026-03-30T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(3);
      expect(dates[0].toISOString()).toBe('2026-01-30T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-02-28T19:00:00.000Z'); // clamped
      expect(dates[2].toISOString()).toBe('2026-03-30T19:00:00.000Z'); // recovered
    });

    it('handles the 29th across months correctly', () => {
      const start = utc('2026-01-29T19:00:00Z');
      const until = utc('2026-04-29T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(4);
      expect(dates[0].toISOString()).toBe('2026-01-29T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-02-28T19:00:00.000Z'); // clamped
      expect(dates[2].toISOString()).toBe('2026-03-29T19:00:00.000Z'); // recovered
      expect(dates[3].toISOString()).toBe('2026-04-29T19:00:00.000Z');
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns only start when until equals start (same day)', () => {
      const start = utc('2026-03-01T19:00:00Z');
      const until = utc('2026-03-01T23:59:59Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(1);
    });

    it('returns only start when until is before the next occurrence (very short range)', () => {
      const start = utc('2026-03-01T19:00:00Z');
      const until = utc('2026-03-01T19:00:00Z'); // same instant
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(1);
    });

    it('includes occurrence when until falls exactly on a recurrence day', () => {
      const start = utc('2026-03-01T19:00:00Z');
      // until is exactly 7 days later at a time after the start time
      const until = utc('2026-03-08T19:00:01Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(2); // Mar 1 and Mar 8
    });

    it('excludes occurrence when until falls just before the recurrence time', () => {
      const start = utc('2026-03-01T19:00:00Z');
      // until is 7 days later but at a time before the start time
      const until = utc('2026-03-08T18:59:59Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      // The next occurrence would be at 19:00, which is after 18:59:59
      expect(dates).toHaveLength(1);
    });

    it('caps at MAX_RECURRENCE_INSTANCES for very long ranges', () => {
      const start = utc('2026-01-01T19:00:00Z');
      const until = utc('2030-12-31T23:59:59Z'); // ~5 years
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(MAX_RECURRENCE_INSTANCES);
      expect(MAX_RECURRENCE_INSTANCES).toBe(52);
    });

    it('caps monthly recurrence at MAX_RECURRENCE_INSTANCES', () => {
      const start = utc('2026-01-15T19:00:00Z');
      const until = utc('2036-12-31T23:59:59Z'); // >10 years
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(MAX_RECURRENCE_INSTANCES);
    });

    it('preserves the time component across all occurrences (weekly)', () => {
      const start = utc('2026-03-01T21:30:00Z');
      const until = utc('2026-03-29T23:59:59Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      for (const d of dates) {
        expect(d.getUTCHours()).toBe(21);
        expect(d.getUTCMinutes()).toBe(30);
      }
    });

    it('preserves the time component across monthly occurrences', () => {
      const start = utc('2026-01-15T21:30:00Z');
      const until = utc('2026-06-15T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      for (const d of dates) {
        expect(d.getUTCHours()).toBe(21);
        expect(d.getUTCMinutes()).toBe(30);
      }
    });

    it('does not mutate the original start date', () => {
      const start = utc('2026-03-01T19:00:00Z');
      const originalTime = start.getTime();
      const until = utc('2026-04-01T23:59:59Z');

      generateRecurringDates(start, 'weekly', until);

      expect(start.getTime()).toBe(originalTime);
    });
  });

  // ─── Year boundary ─────────────────────────────────────────────────────

  describe('year boundary', () => {
    it('handles monthly recurrence across year boundary', () => {
      const start = utc('2026-11-15T19:00:00Z');
      const until = utc('2027-02-15T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(4);
      expect(dates[0].toISOString()).toBe('2026-11-15T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-12-15T19:00:00.000Z');
      expect(dates[2].toISOString()).toBe('2027-01-15T19:00:00.000Z');
      expect(dates[3].toISOString()).toBe('2027-02-15T19:00:00.000Z');
    });

    it('handles weekly recurrence across year boundary', () => {
      const start = utc('2026-12-28T19:00:00Z');
      const until = utc('2027-01-18T23:59:59Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(4);
      expect(dates[0].toISOString()).toBe('2026-12-28T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2027-01-04T19:00:00.000Z');
      expect(dates[2].toISOString()).toBe('2027-01-11T19:00:00.000Z');
      expect(dates[3].toISOString()).toBe('2027-01-18T19:00:00.000Z');
    });
  });

  // --- Adversarial / additional edge cases (ROK-422 QA hardening) ------------

  describe('adversarial edge cases', () => {
    // until before start — function should still return [start]

    it('returns only start when until is strictly before start (weekly)', () => {
      const start = utc('2026-06-15T19:00:00Z');
      const until = utc('2026-06-01T00:00:00Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(1);
      expect(dates[0].toISOString()).toBe('2026-06-15T19:00:00.000Z');
    });

    it('returns only start when until is strictly before start (monthly)', () => {
      const start = utc('2026-06-15T19:00:00Z');
      const until = utc('2026-05-01T00:00:00Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(1);
      expect(dates[0].toISOString()).toBe('2026-06-15T19:00:00.000Z');
    });

    // biweekly cap enforcement

    it('caps biweekly recurrence at MAX_RECURRENCE_INSTANCES', () => {
      const start = utc('2026-01-01T19:00:00Z');
      const until = utc('2050-12-31T23:59:59Z');
      const dates = generateRecurringDates(start, 'biweekly', until);

      expect(dates).toHaveLength(MAX_RECURRENCE_INSTANCES);
    });

    // December 31 monthly rolls over into next year correctly

    it('handles Dec 31 monthly chain: Dec 31 -> Jan 31 -> Feb 28 -> Mar 31 (non-leap)', () => {
      const start = utc('2025-12-31T19:00:00Z');
      const until = utc('2026-03-31T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(4);
      expect(dates[0].toISOString()).toBe('2025-12-31T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-01-31T19:00:00.000Z');
      expect(dates[2].toISOString()).toBe('2026-02-28T19:00:00.000Z'); // clamped
      expect(dates[3].toISOString()).toBe('2026-03-31T19:00:00.000Z'); // recovered
    });

    // Long clamping sequence — drift prevention over 6+ months

    it('prevents drift over a Jan 31 chain spanning 7 months', () => {
      // Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31 -> Jun 30 -> Jul 31
      const start = utc('2026-01-31T12:00:00Z');
      const until = utc('2026-07-31T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(7);
      expect(dates[0].toISOString()).toBe('2026-01-31T12:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-02-28T12:00:00.000Z'); // clamped
      expect(dates[2].toISOString()).toBe('2026-03-31T12:00:00.000Z'); // recovered
      expect(dates[3].toISOString()).toBe('2026-04-30T12:00:00.000Z'); // clamped (Apr has 30)
      expect(dates[4].toISOString()).toBe('2026-05-31T12:00:00.000Z'); // recovered
      expect(dates[5].toISOString()).toBe('2026-06-30T12:00:00.000Z'); // clamped (Jun has 30)
      expect(dates[6].toISOString()).toBe('2026-07-31T12:00:00.000Z'); // recovered
    });

    // Feb 28 start should NOT clamp — day 28 is valid in all months

    it('handles Feb 28 start in non-leap year without spurious clamping', () => {
      const start = utc('2026-02-28T19:00:00Z');
      const until = utc('2026-05-28T23:59:59Z');
      const dates = generateRecurringDates(start, 'monthly', until);

      expect(dates).toHaveLength(4);
      expect(dates[0].toISOString()).toBe('2026-02-28T19:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-03-28T19:00:00.000Z');
      expect(dates[2].toISOString()).toBe('2026-04-28T19:00:00.000Z');
      expect(dates[3].toISOString()).toBe('2026-05-28T19:00:00.000Z');
    });

    // Exactly 52nd instance lands on until — inclusive boundary

    it('includes the 52nd instance when it falls exactly on until', () => {
      const start = utc('2026-01-01T19:00:00Z');
      // 51 weeks after start = the 52nd weekly occurrence
      const fiftySecondDate = new Date(start.getTime() + 51 * 7 * 24 * 60 * 60 * 1000);
      const until = new Date(fiftySecondDate.getTime()); // exactly equal
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(MAX_RECURRENCE_INSTANCES);
      expect(dates[51].toISOString()).toBe(fiftySecondDate.toISOString());
    });

    // Cap never exceeded across all three frequencies

    it('never generates more than 52 instances regardless of frequency', () => {
      const start = utc('2026-01-01T00:00:00Z');
      const until = utc('2099-12-31T23:59:59Z');

      const weekly = generateRecurringDates(start, 'weekly', until);
      const biweekly = generateRecurringDates(start, 'biweekly', until);
      const monthly = generateRecurringDates(start, 'monthly', until);

      expect(weekly.length).toBeLessThanOrEqual(MAX_RECURRENCE_INSTANCES);
      expect(biweekly.length).toBeLessThanOrEqual(MAX_RECURRENCE_INSTANCES);
      expect(monthly.length).toBeLessThanOrEqual(MAX_RECURRENCE_INSTANCES);
    });

    // Start always first element — even with inverted until

    it('always returns start as the first element regardless of until value', () => {
      const start = utc('2026-03-15T10:00:00Z');

      const d1 = generateRecurringDates(start, 'weekly', utc('2020-01-01T00:00:00Z'));
      expect(d1[0].toISOString()).toBe('2026-03-15T10:00:00.000Z');

      const d2 = generateRecurringDates(start, 'monthly', utc('2026-03-15T10:00:00Z'));
      expect(d2[0].toISOString()).toBe('2026-03-15T10:00:00.000Z');
    });

    // DST boundary: weekly uses UTC math so time must not drift

    it('weekly recurrence does not drift across a US DST transition (UTC-stable)', () => {
      // US clocks spring forward on 2026-03-08. UTC-based +7 days must not shift the time.
      const start = utc('2026-03-01T03:00:00Z');
      const until = utc('2026-03-22T23:59:59Z');
      const dates = generateRecurringDates(start, 'weekly', until);

      expect(dates).toHaveLength(4);
      for (const d of dates) {
        expect(d.getUTCHours()).toBe(3);
        expect(d.getUTCMinutes()).toBe(0);
      }
    });
  });
});
