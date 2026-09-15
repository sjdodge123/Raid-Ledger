/**
 * ROK-1570 — the week the heatmap RENDERS must be the week the server
 * subtracts commitments from.
 *
 * `getWeekStart` returns LOCAL Sunday 00:00. Serialising that with
 * `toISOString()` is wrong for every viewer east of UTC: local Sunday 00:00 in
 * UTC+2 is Saturday 22:00Z, which the server normalises to the PREVIOUS UTC
 * week — so the grid paints week N while the API subtracts week N-1.
 * `weekStartQueryValue` sends the calendar date instead, at 00:00Z.
 */
import { describe, it, expect } from 'vitest';
import { getWeekStart, weekStartQueryValue } from '../scheduling-availability';

describe('weekStartQueryValue (ROK-1570)', () => {
  it('sends the local calendar Sunday at 00:00Z, not the local instant', () => {
    // Local midnight on a Sunday, whatever the runner's zone is.
    const localSunday = getWeekStart(new Date(2026, 4, 13, 15, 30));

    expect(weekStartQueryValue(localSunday)).toBe('2026-05-10T00:00:00.000Z');
  });

  it('keeps the calendar date even when local midnight falls on the previous UTC day', () => {
    // Construct from LOCAL components so a UTC+N runner puts the instant on
    // the preceding UTC date — the exact case `toISOString()` gets wrong.
    const localSunday = new Date(2026, 0, 4, 0, 0, 0, 0);

    expect(weekStartQueryValue(localSunday)).toBe('2026-01-04T00:00:00.000Z');
    expect(weekStartQueryValue(localSunday).slice(0, 10)).toBe(
      `${localSunday.getFullYear()}-01-0${localSunday.getDate()}`,
    );
  });
});
