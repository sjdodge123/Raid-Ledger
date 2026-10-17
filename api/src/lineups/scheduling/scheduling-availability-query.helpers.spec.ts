/**
 * ROK-1570 — `?weekStart=` parsing for the scheduling heatmap.
 *
 * These three cases pin the contract lane 1's helper depends on: an unusable
 * value must become `undefined` (so the helper's current-week default applies)
 * and a usable one must be normalised to the Sunday the grid's day 0 is.
 */
import { parseWeekStartQuery } from './scheduling-availability-query.helpers';

describe('parseWeekStartQuery', () => {
  it('returns undefined when the param is absent or empty', () => {
    expect(parseWeekStartQuery()).toBeUndefined();
    expect(parseWeekStartQuery('')).toBeUndefined();
    expect(parseWeekStartQuery('   ')).toBeUndefined();
  });

  it('returns undefined for an unparseable value rather than an invalid Date', () => {
    expect(parseWeekStartQuery('abc')).toBeUndefined();
    expect(parseWeekStartQuery('2026-13-45T99:00:00Z')).toBeUndefined();
  });

  it('normalises a mid-week instant to Sunday 00:00 UTC of that week', () => {
    // Wednesday 2026-09-16T21:30:00Z -> Sunday 2026-09-13T00:00:00Z.
    const parsed = parseWeekStartQuery('2026-09-16T21:30:00.000Z');

    expect(parsed?.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });

  it('is idempotent on a value that is already a Sunday midnight', () => {
    const parsed = parseWeekStartQuery('2026-09-13T00:00:00.000Z');

    expect(parsed?.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });
});
