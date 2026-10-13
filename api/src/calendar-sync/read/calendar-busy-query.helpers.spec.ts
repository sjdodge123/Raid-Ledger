/**
 * ROK-1593 A7 — pure rules of the calendar busy-hour query: the R4 ±60 s
 * safety net, the read-mode filter and the composite range collapse. The SQL
 * filters (connection status, read_enabled, overlap) are proven in
 * `lineups/scheduling/scheduling-availability.integration.spec.ts`.
 */
import {
  blockCountsForMode,
  busyRangesForBlocks,
  calendarBusyWeekStart,
  matchesSignupBounds,
  toBusyRanges,
} from './calendar-busy-query.helpers';
import type { CalendarBusyBlock } from './calendar-busy-query.helpers';

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

describe('composite busy hours key to the viewer local week (ROK-1595)', () => {
  const MDT = 360; // getTimezoneOffset() for UTC-6
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const block = (startsAt: string, endsAt: string): CalendarBusyBlock => ({
    userId: 1,
    provider: 'google',
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
  });
  // Mon 20:00 MDT and Sun 01:00 MDT, as UTC instants.
  const MON_EVENING = block('2026-10-13T02:00:00Z', '2026-10-13T03:00:00Z');
  const SUN_EARLY = block('2026-10-11T07:00:00Z', '2026-10-11T08:00:00Z');

  function ranges(weekStart: Date, weekSent: boolean) {
    const start = calendarBusyWeekStart(weekStart, MDT, weekSent);
    const end = new Date(start.getTime() + WEEK_MS);
    return busyRangesForBlocks([MON_EVENING, SUN_EARLY], start, end, MDT);
  }

  it('no week sent: shifts the server Sunday 00:00Z to the local Sunday', () => {
    expect(ranges(new Date('2026-10-11T00:00:00Z'), false)).toEqual([
      { dayOfWeek: 0, startHour: 1, endHour: 2, provider: 'google' },
      { dayOfWeek: 1, startHour: 20, endHour: 21, provider: 'google' },
    ]);
  });

  it('week sent as the local Sunday: no second shift', () => {
    expect(ranges(new Date('2026-10-11T06:00:00Z'), true)).toEqual([
      { dayOfWeek: 0, startHour: 1, endHour: 2, provider: 'google' },
      { dayOfWeek: 1, startHour: 20, endHour: 21, provider: 'google' },
    ]);
  });

  it('east of UTC (UTC+2, no week): local Sunday starts Saturday 22:00Z', () => {
    const CEST = -120;
    const start = calendarBusyWeekStart(
      new Date('2026-10-11T00:00:00Z'),
      CEST,
      false,
    );
    expect(start.toISOString()).toBe('2026-10-10T22:00:00.000Z');
    // Sun 01:00 and Mon 01:00 local, i.e. 23:00Z the evening before.
    const blocks = [
      block('2026-10-10T23:00:00Z', '2026-10-11T00:00:00Z'),
      block('2026-10-11T23:00:00Z', '2026-10-12T00:00:00Z'),
    ];
    const end = new Date(start.getTime() + WEEK_MS);
    expect(busyRangesForBlocks(blocks, start, end, CEST)).toEqual([
      { dayOfWeek: 0, startHour: 1, endHour: 2, provider: 'google' },
      { dayOfWeek: 1, startHour: 1, endHour: 2, provider: 'google' },
    ]);
  });
});
