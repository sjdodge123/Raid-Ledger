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

// ─── Weekly ─────────────────────────────────────────────────────────────────

function testWeeklyDates() {
  const start = utc('2026-03-01T19:00:00Z');
  const until = utc('2026-03-29T23:59:59Z');
  const dates = generateRecurringDates(start, 'weekly', until);

  expect(dates).toHaveLength(5);
  expect(dates[0].toISOString()).toBe('2026-03-01T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-03-08T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-03-15T19:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2026-03-22T19:00:00.000Z');
  expect(dates[4].toISOString()).toBe('2026-03-29T19:00:00.000Z');
}

function testWeeklyStopsAtUntil() {
  const start = utc('2026-03-01T19:00:00Z');
  const until = utc('2026-03-10T23:59:59Z');
  const dates = generateRecurringDates(start, 'weekly', until);
  expect(dates).toHaveLength(2);
}

function testWeeklyOnlyStartWhenShortRange() {
  const start = utc('2026-03-01T19:00:00Z');
  const until = utc('2026-03-05T23:59:59Z');
  const dates = generateRecurringDates(start, 'weekly', until);
  expect(dates).toHaveLength(1);
  expect(dates[0].toISOString()).toBe('2026-03-01T19:00:00.000Z');
}

// ─── Biweekly ───────────────────────────────────────────────────────────────

function testBiweeklyDates() {
  const start = utc('2026-01-05T20:00:00Z');
  const until = utc('2026-03-02T23:59:59Z');
  const dates = generateRecurringDates(start, 'biweekly', until);

  expect(dates).toHaveLength(5);
  expect(dates[0].toISOString()).toBe('2026-01-05T20:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-01-19T20:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-02-02T20:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2026-02-16T20:00:00.000Z');
  expect(dates[4].toISOString()).toBe('2026-03-02T20:00:00.000Z');
}

// ─── Monthly ────────────────────────────────────────────────────────────────

function testMonthlyMidMonth() {
  const start = utc('2026-01-15T19:00:00Z');
  const until = utc('2026-04-15T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(4);
  expect(dates[0].toISOString()).toBe('2026-01-15T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-02-15T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-03-15T19:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2026-04-15T19:00:00.000Z');
}

function testMonthlyJan31NonLeap() {
  const start = utc('2026-01-31T19:00:00Z');
  const until = utc('2026-05-31T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(5);
  expect(dates[0].toISOString()).toBe('2026-01-31T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-02-28T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-03-31T19:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2026-04-30T19:00:00.000Z');
  expect(dates[4].toISOString()).toBe('2026-05-31T19:00:00.000Z');
}

function testMonthlyJan31Leap() {
  const start = utc('2028-01-31T19:00:00Z');
  const until = utc('2028-03-31T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(3);
  expect(dates[0].toISOString()).toBe('2028-01-31T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2028-02-29T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2028-03-31T19:00:00.000Z');
}

function testMonthlyJan30() {
  const start = utc('2026-01-30T19:00:00Z');
  const until = utc('2026-03-30T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(3);
  expect(dates[0].toISOString()).toBe('2026-01-30T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-02-28T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-03-30T19:00:00.000Z');
}

function testMonthly29th() {
  const start = utc('2026-01-29T19:00:00Z');
  const until = utc('2026-04-29T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(4);
  expect(dates[0].toISOString()).toBe('2026-01-29T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-02-28T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-03-29T19:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2026-04-29T19:00:00.000Z');
}

// ─── Edge cases ─────────────────────────────────────────────────────────────

function testOnlyStartWhenUntilSameDay() {
  const start = utc('2026-03-01T19:00:00Z');
  const until = utc('2026-03-01T23:59:59Z');
  expect(generateRecurringDates(start, 'weekly', until)).toHaveLength(1);
}

function testOnlyStartWhenUntilSameInstant() {
  const start = utc('2026-03-01T19:00:00Z');
  const until = utc('2026-03-01T19:00:00Z');
  expect(generateRecurringDates(start, 'weekly', until)).toHaveLength(1);
}

function testIncludesWhenUntilAfterRecurrenceTime() {
  const start = utc('2026-03-01T19:00:00Z');
  const until = utc('2026-03-08T19:00:01Z');
  expect(generateRecurringDates(start, 'weekly', until)).toHaveLength(2);
}

function testExcludesWhenUntilBeforeRecurrenceTime() {
  const start = utc('2026-03-01T19:00:00Z');
  const until = utc('2026-03-08T18:59:59Z');
  expect(generateRecurringDates(start, 'weekly', until)).toHaveLength(1);
}

function testCapsWeeklyAtMax() {
  const start = utc('2026-01-01T19:00:00Z');
  const until = utc('2030-12-31T23:59:59Z');
  const dates = generateRecurringDates(start, 'weekly', until);
  expect(dates).toHaveLength(MAX_RECURRENCE_INSTANCES);
  expect(MAX_RECURRENCE_INSTANCES).toBe(52);
}

function testCapsMonthlyAtMax() {
  const start = utc('2026-01-15T19:00:00Z');
  const until = utc('2036-12-31T23:59:59Z');
  expect(generateRecurringDates(start, 'monthly', until)).toHaveLength(
    MAX_RECURRENCE_INSTANCES,
  );
}

function testPreservesTimeWeekly() {
  const start = utc('2026-03-01T21:30:00Z');
  const until = utc('2026-03-29T23:59:59Z');
  for (const d of generateRecurringDates(start, 'weekly', until)) {
    expect(d.getUTCHours()).toBe(21);
    expect(d.getUTCMinutes()).toBe(30);
  }
}

function testPreservesTimeMonthly() {
  const start = utc('2026-01-15T21:30:00Z');
  const until = utc('2026-06-15T23:59:59Z');
  for (const d of generateRecurringDates(start, 'monthly', until)) {
    expect(d.getUTCHours()).toBe(21);
    expect(d.getUTCMinutes()).toBe(30);
  }
}

function testDoesNotMutateStart() {
  const start = utc('2026-03-01T19:00:00Z');
  const originalTime = start.getTime();
  generateRecurringDates(start, 'weekly', utc('2026-04-01T23:59:59Z'));
  expect(start.getTime()).toBe(originalTime);
}

// ─── Year boundary ──────────────────────────────────────────────────────────

function testMonthlyAcrossYearBoundary() {
  const start = utc('2026-11-15T19:00:00Z');
  const until = utc('2027-02-15T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(4);
  expect(dates[0].toISOString()).toBe('2026-11-15T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-12-15T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2027-01-15T19:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2027-02-15T19:00:00.000Z');
}

function testWeeklyAcrossYearBoundary() {
  const start = utc('2026-12-28T19:00:00Z');
  const until = utc('2027-01-18T23:59:59Z');
  const dates = generateRecurringDates(start, 'weekly', until);

  expect(dates).toHaveLength(4);
  expect(dates[0].toISOString()).toBe('2026-12-28T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2027-01-04T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2027-01-11T19:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2027-01-18T19:00:00.000Z');
}

// ─── Adversarial edge cases ─────────────────────────────────────────────────

function testUntilBeforeStartWeekly() {
  const start = utc('2026-06-15T19:00:00Z');
  const until = utc('2026-06-01T00:00:00Z');
  const dates = generateRecurringDates(start, 'weekly', until);
  expect(dates).toHaveLength(1);
  expect(dates[0].toISOString()).toBe('2026-06-15T19:00:00.000Z');
}

function testUntilBeforeStartMonthly() {
  const start = utc('2026-06-15T19:00:00Z');
  const until = utc('2026-05-01T00:00:00Z');
  const dates = generateRecurringDates(start, 'monthly', until);
  expect(dates).toHaveLength(1);
  expect(dates[0].toISOString()).toBe('2026-06-15T19:00:00.000Z');
}

function testCapsBiweeklyAtMax() {
  const start = utc('2026-01-01T19:00:00Z');
  const until = utc('2050-12-31T23:59:59Z');
  expect(generateRecurringDates(start, 'biweekly', until)).toHaveLength(
    MAX_RECURRENCE_INSTANCES,
  );
}

function testDec31MonthlyChain() {
  const start = utc('2025-12-31T19:00:00Z');
  const until = utc('2026-03-31T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(4);
  expect(dates[0].toISOString()).toBe('2025-12-31T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-01-31T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-02-28T19:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2026-03-31T19:00:00.000Z');
}

function testDriftPreventionJan31Chain() {
  const start = utc('2026-01-31T12:00:00Z');
  const until = utc('2026-07-31T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(7);
  expect(dates[0].toISOString()).toBe('2026-01-31T12:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-02-28T12:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-03-31T12:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2026-04-30T12:00:00.000Z');
  expect(dates[4].toISOString()).toBe('2026-05-31T12:00:00.000Z');
  expect(dates[5].toISOString()).toBe('2026-06-30T12:00:00.000Z');
  expect(dates[6].toISOString()).toBe('2026-07-31T12:00:00.000Z');
}

function testFeb28NoClamping() {
  const start = utc('2026-02-28T19:00:00Z');
  const until = utc('2026-05-28T23:59:59Z');
  const dates = generateRecurringDates(start, 'monthly', until);

  expect(dates).toHaveLength(4);
  expect(dates[0].toISOString()).toBe('2026-02-28T19:00:00.000Z');
  expect(dates[1].toISOString()).toBe('2026-03-28T19:00:00.000Z');
  expect(dates[2].toISOString()).toBe('2026-04-28T19:00:00.000Z');
  expect(dates[3].toISOString()).toBe('2026-05-28T19:00:00.000Z');
}

function test52ndInstanceInclusiveBoundary() {
  const start = utc('2026-01-01T19:00:00Z');
  const fiftySecondDate = new Date(
    start.getTime() + 51 * 7 * 24 * 60 * 60 * 1000,
  );
  const until = new Date(fiftySecondDate.getTime());
  const dates = generateRecurringDates(start, 'weekly', until);

  expect(dates).toHaveLength(MAX_RECURRENCE_INSTANCES);
  expect(dates[51].toISOString()).toBe(fiftySecondDate.toISOString());
}

function testNeverExceeds52() {
  const start = utc('2026-01-01T00:00:00Z');
  const until = utc('2099-12-31T23:59:59Z');

  const weekly = generateRecurringDates(start, 'weekly', until);
  const biweekly = generateRecurringDates(start, 'biweekly', until);
  const monthly = generateRecurringDates(start, 'monthly', until);

  expect(weekly.length).toBeLessThanOrEqual(MAX_RECURRENCE_INSTANCES);
  expect(biweekly.length).toBeLessThanOrEqual(MAX_RECURRENCE_INSTANCES);
  expect(monthly.length).toBeLessThanOrEqual(MAX_RECURRENCE_INSTANCES);
}

function testStartAlwaysFirst() {
  const start = utc('2026-03-15T10:00:00Z');
  const d1 = generateRecurringDates(
    start,
    'weekly',
    utc('2020-01-01T00:00:00Z'),
  );
  expect(d1[0].toISOString()).toBe('2026-03-15T10:00:00.000Z');

  const d2 = generateRecurringDates(
    start,
    'monthly',
    utc('2026-03-15T10:00:00Z'),
  );
  expect(d2[0].toISOString()).toBe('2026-03-15T10:00:00.000Z');
}

function testDstStability() {
  const start = utc('2026-03-01T03:00:00Z');
  const until = utc('2026-03-22T23:59:59Z');
  const dates = generateRecurringDates(start, 'weekly', until);

  expect(dates).toHaveLength(4);
  for (const d of dates) {
    expect(d.getUTCHours()).toBe(3);
    expect(d.getUTCMinutes()).toBe(0);
  }
}

describe('generateRecurringDates — weekly', () => {
  it('generates correct weekly dates', () => testWeeklyDates());
  it('stops when next exceeds until', () => testWeeklyStopsAtUntil());
  it('returns only start for short range', () =>
    testWeeklyOnlyStartWhenShortRange());
});

describe('generateRecurringDates — biweekly', () => {
  it('generates correct biweekly dates', () => testBiweeklyDates());
});

describe('generateRecurringDates — monthly', () => {
  it('generates correct mid-month dates', () => testMonthlyMidMonth());
  it('clamps Jan 31 -> Feb 28 (non-leap) and recovers', () =>
    testMonthlyJan31NonLeap());
  it('clamps Jan 31 -> Feb 29 (leap year)', () => testMonthlyJan31Leap());
  it('handles Jan 30 -> Feb 28 -> Mar 30', () => testMonthlyJan30());
  it('handles 29th across months', () => testMonthly29th());
});

describe('generateRecurringDates — edge cases', () => {
  it('returns only start when until same day', () =>
    testOnlyStartWhenUntilSameDay());
  it('returns only start when until same instant', () =>
    testOnlyStartWhenUntilSameInstant());
  it('includes occurrence when until after recurrence time', () =>
    testIncludesWhenUntilAfterRecurrenceTime());
  it('excludes occurrence when until before recurrence time', () =>
    testExcludesWhenUntilBeforeRecurrenceTime());
  it('caps weekly at MAX_RECURRENCE_INSTANCES', () => testCapsWeeklyAtMax());
  it('caps monthly at MAX_RECURRENCE_INSTANCES', () => testCapsMonthlyAtMax());
  it('preserves time across weekly occurrences', () =>
    testPreservesTimeWeekly());
  it('preserves time across monthly occurrences', () =>
    testPreservesTimeMonthly());
  it('does not mutate the original start date', () => testDoesNotMutateStart());
});

describe('generateRecurringDates — year boundary', () => {
  it('handles monthly across year boundary', () =>
    testMonthlyAcrossYearBoundary());
  it('handles weekly across year boundary', () =>
    testWeeklyAcrossYearBoundary());
});

describe('generateRecurringDates — adversarial', () => {
  it('returns only start when until before start (weekly)', () =>
    testUntilBeforeStartWeekly());
  it('returns only start when until before start (monthly)', () =>
    testUntilBeforeStartMonthly());
  it('caps biweekly at MAX_RECURRENCE_INSTANCES', () =>
    testCapsBiweeklyAtMax());
  it('handles Dec 31 monthly chain', () => testDec31MonthlyChain());
  it('prevents drift over Jan 31 chain spanning 7 months', () =>
    testDriftPreventionJan31Chain());
  it('handles Feb 28 start without spurious clamping', () =>
    testFeb28NoClamping());
  it('includes 52nd instance on inclusive boundary', () =>
    test52ndInstanceInclusiveBoundary());
  it('never generates more than 52 instances', () => testNeverExceeds52());
  it('always returns start as first element', () => testStartAlwaysFirst());
  it('weekly does not drift across DST (UTC-stable)', () => testDstStability());
});
