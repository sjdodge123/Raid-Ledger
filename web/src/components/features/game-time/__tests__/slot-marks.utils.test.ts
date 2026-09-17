/**
 * ROK-1587 / ROK-1588 — pure helpers behind the "already suggested" marks and
 * the week-columns cell copy.
 */
import { describe, it, expect } from 'vitest';
import {
  cellInstant,
  cellTimeLabel,
  groupCellAriaLabel,
  slotCountsByDay,
  slotMarksForWeek,
  votedLabel,
} from '../slot-marks.utils';

/** Sunday 2026-09-20 00:00 local. */
const WEEK = new Date(2026, 8, 20, 0, 0, 0, 0);

function slot(date: Date, votes = 0): { proposedTime: string; votes: unknown[] } {
  return { proposedTime: date.toISOString(), votes: Array.from({ length: votes }, (_, i) => i) };
}

describe('slotMarksForWeek', () => {
  it('keeps a slot inside the week keyed by day:hour with its vote count', () => {
    const marks = slotMarksForWeek([slot(new Date(2026, 8, 23, 20), 2)], WEEK);
    expect([...marks.entries()]).toEqual([['3:20', { dayOfWeek: 3, hour: 20, votes: 2 }]]);
  });

  it('includes the Sunday 00:00 boundary and excludes next Sunday 00:00', () => {
    const marks = slotMarksForWeek(
      [slot(new Date(2026, 8, 20, 0), 1), slot(new Date(2026, 8, 27, 0), 1), slot(new Date(2026, 8, 27, 0, 30), 1)],
      WEEK,
    );
    expect([...marks.keys()]).toEqual(['0:0']);
  });

  it('drops a slot before the week', () => {
    expect(slotMarksForWeek([slot(new Date(2026, 8, 19, 23, 30), 3)], WEEK).size).toBe(0);
  });

  it('sums votes for two slots in the same hour', () => {
    const marks = slotMarksForWeek(
      [slot(new Date(2026, 8, 23, 20), 2), slot(new Date(2026, 8, 23, 20, 30), 3)],
      WEEK,
    );
    expect(marks.size).toBe(1);
    expect(marks.get('3:20')?.votes).toBe(5);
  });

  it('keeps a slot with zero votes', () => {
    expect(slotMarksForWeek([slot(new Date(2026, 8, 24, 21), 0)], WEEK).get('4:21')).toEqual({
      dayOfWeek: 4, hour: 21, votes: 0,
    });
  });
});

describe('slotCountsByDay', () => {
  it('counts marks per day of the week', () => {
    const marks = slotMarksForWeek(
      [slot(new Date(2026, 8, 23, 20)), slot(new Date(2026, 8, 23, 21)), slot(new Date(2026, 8, 26, 9))],
      WEEK,
    );
    expect(slotCountsByDay(marks)).toEqual([0, 0, 0, 2, 0, 0, 1]);
  });

  it('is seven zeros for no marks', () => {
    expect(slotCountsByDay(new Map())).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('votedLabel', () => {
  it.each([[0, '0 voted'], [1, '1 voted'], [2, '2 voted']])('%i → %s', (votes, label) => {
    expect(votedLabel(votes)).toBe(label);
  });
});

describe('groupCellAriaLabel', () => {
  const fresh = { available: 5, total: 8, stale: 0, unknown: 2, busy: 1 };

  it('reads the freshness counts with the vote clause', () => {
    expect(groupCellAriaLabel(3, 20, fresh, { votes: 2 })).toBe('Wed 8 PM: 5 free, 1 busy, 2 voted');
  });

  it('adds the stale clause when someone is stale', () => {
    expect(groupCellAriaLabel(3, 20, { ...fresh, stale: 1 }, {})).toBe('Wed 8 PM: 5 free, 1 stale, 1 busy');
  });

  it('omits zero stale / busy clauses and absent votes', () => {
    expect(groupCellAriaLabel(3, 20, { ...fresh, busy: 0 }, {})).toBe('Wed 8 PM: 5 free');
  });

  it('keeps "0 voted" when a slot exists with no votes', () => {
    expect(groupCellAriaLabel(3, 20, { ...fresh, busy: 0 }, { votes: 0 })).toBe('Wed 8 PM: 5 free, 0 voted');
  });

  it('reads the legacy aggregate as N of M free', () => {
    expect(groupCellAriaLabel(3, 20, { available: 4, total: 5 }, {})).toBe('Wed 8 PM: 4 of 5 free');
  });

  it('reads an undefined cell as no data', () => {
    expect(groupCellAriaLabel(3, 20, undefined, {})).toBe('Wed 8 PM: no data');
  });

  it('appends your game time, suggested and current time in order', () => {
    expect(
      groupCellAriaLabel(0, 0, { available: 1, total: 2 }, { you: true, picked: true, current: true }),
    ).toBe('Sun 12 AM: 1 of 2 free, your game time, suggested, current time');
  });
});

describe('cellTimeLabel', () => {
  it('reads short day + hour', () => {
    expect(cellTimeLabel(WEEK, 3, 21)).toBe('Wed 9 PM');
  });

  it('reads with the date', () => {
    expect(cellTimeLabel(WEEK, 3, 21, true)).toBe('Wed Sep 23, 9 PM');
  });

  it('reads midnight and noon as 12 AM / 12 PM', () => {
    expect(cellTimeLabel(WEEK, 6, 0)).toBe('Sat 12 AM');
    expect(cellTimeLabel(WEEK, 6, 12, true)).toBe('Sat Sep 26, 12 PM');
  });

  it('rolls the date across a month boundary', () => {
    expect(cellTimeLabel(new Date(2026, 8, 27), 4, 8, true)).toBe('Thu Oct 1, 8 AM');
  });
});

describe('cellInstant', () => {
  it('is the local wall-clock day + hour of the week', () => {
    const at = cellInstant(WEEK, 3, 20);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 8, 23, 20, 0]);
  });

  it('keeps the wall-clock hour across a DST change (local date math, not 24h multiples)', () => {
    // US DST ends 2026-11-01; EU on 2026-10-25. Both weeks are covered.
    for (const week of [new Date(2026, 9, 25), new Date(2026, 10, 1)]) {
      const at = cellInstant(week, 5, 20);
      expect(at.getDay()).toBe(5);
      expect(at.getHours()).toBe(20);
      expect(at.getDate()).toBe(week.getDate() + 5);
    }
  });

  it('does not mutate weekStart', () => {
    const week = new Date(WEEK);
    cellInstant(week, 6, 23);
    expect(week.getTime()).toBe(WEEK.getTime());
  });
});
