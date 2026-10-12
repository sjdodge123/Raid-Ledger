/**
 * ROK-1593 A7 — pure rules of the calendar busy-hour query: the R4 ±60 s
 * safety net, the read-mode filter and the composite range collapse. The SQL
 * filters (connection status, read_enabled, overlap) are proven in
 * `lineups/scheduling/scheduling-availability.integration.spec.ts`.
 */
import {
  blockCountsForMode,
  matchesSignupBounds,
  toBusyRanges,
} from './calendar-busy-query.helpers';

const START = new Date('2026-03-03T20:30:00.000Z');
const END = new Date('2026-03-03T22:15:00.000Z');
const SIGNUPS: [Date, Date][] = [[START, END]];

function shifted(seconds: number): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: new Date(START.getTime() + seconds * 1000),
    endsAt: new Date(END.getTime() + seconds * 1000),
  };
}

describe('matchesSignupBounds (R4 safety net)', () => {
  it('drops a block 59 s off both bounds', () => {
    expect(matchesSignupBounds(shifted(59), SIGNUPS)).toBe(true);
    expect(matchesSignupBounds(shifted(-59), SIGNUPS)).toBe(true);
  });

  it('drops a block exactly 60 s off (inclusive bound)', () => {
    expect(matchesSignupBounds(shifted(60), SIGNUPS)).toBe(true);
  });

  it('keeps a block 61 s off', () => {
    expect(matchesSignupBounds(shifted(61), SIGNUPS)).toBe(false);
    expect(matchesSignupBounds(shifted(-61), SIGNUPS)).toBe(false);
  });

  it('keeps a block that matches only ONE bound', () => {
    const block = { startsAt: START, endsAt: new Date(END.getTime() + 3600e3) };
    expect(matchesSignupBounds(block, SIGNUPS)).toBe(false);
  });

  it('keeps every block when the user has no sign-ups', () => {
    expect(matchesSignupBounds(shifted(0), [])).toBe(false);
  });
});

describe('blockCountsForMode (D12)', () => {
  it('days → neither timed nor all-day blocks are busy hours', () => {
    expect(blockCountsForMode(false, 'days')).toBe(false);
    expect(blockCountsForMode(true, 'days')).toBe(false);
  });

  it('both → timed only (all-day blocks become away days)', () => {
    expect(blockCountsForMode(false, 'both')).toBe(true);
    expect(blockCountsForMode(true, 'both')).toBe(false);
  });

  it('hours → timed AND all-day blocks', () => {
    expect(blockCountsForMode(false, 'hours')).toBe(true);
    expect(blockCountsForMode(true, 'hours')).toBe(true);
  });
});

describe('toBusyRanges', () => {
  it('collapses contiguous hours and splits at a gap', () => {
    const hours = new Map([['google|2', new Set([22, 20, 21, 23, 1])]]);
    expect(toBusyRanges(hours)).toEqual([
      { dayOfWeek: 2, startHour: 1, endHour: 2, provider: 'google' },
      { dayOfWeek: 2, startHour: 20, endHour: 24, provider: 'google' },
    ]);
  });

  it('keeps days apart and sorts by day then hour', () => {
    const hours = new Map([
      ['google|4', new Set([9])],
      ['google|1', new Set([9])],
    ]);
    expect(toBusyRanges(hours).map((r) => r.dayOfWeek)).toEqual([1, 4]);
  });

  it('drops an unknown provider rather than emitting it', () => {
    expect(toBusyRanges(new Map([['outlook|1', new Set([9])]]))).toEqual([]);
  });
});
