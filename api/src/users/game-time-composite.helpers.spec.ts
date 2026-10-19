/**
 * ROK-1842 — the composite view's absence expansion is clamped to the week
 * being rendered. Before, `buildAbsenceDateSet` walked every day of an
 * absence's full range: a stored 0001-01-01..9999-12-31 row cost 3.64M loop
 * iterations (~4s CPU, ~270MB) on every `/users/me/game-time` read.
 */
import {
  buildAbsenceDateSet,
  compositeWeekWindow,
} from './game-time-composite.helpers';

const WEEK = { firstDate: '2026-04-05', lastDate: '2026-04-11' };

describe('buildAbsenceDateSet (ROK-1842)', () => {
  it('a year-1 to year-9999 absence yields only the 7 week days', () => {
    const dates = buildAbsenceDateSet(
      [{ startDate: '0001-01-01', endDate: '9999-12-31' }],
      WEEK,
    );
    expect([...dates].sort()).toEqual([
      '2026-04-05',
      '2026-04-06',
      '2026-04-07',
      '2026-04-08',
      '2026-04-09',
      '2026-04-10',
      '2026-04-11',
    ]);
  });

  it('finishes a year-1 to year-9999 absence in well under 50ms', () => {
    const started = performance.now();
    buildAbsenceDateSet(
      [{ startDate: '0001-01-01', endDate: '9999-12-31' }],
      WEEK,
    );
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('keeps only the overlapping days of a partially overlapping absence', () => {
    const dates = buildAbsenceDateSet(
      [{ startDate: '2026-04-09', endDate: '2026-05-30' }],
      WEEK,
    );
    expect([...dates].sort()).toEqual([
      '2026-04-09',
      '2026-04-10',
      '2026-04-11',
    ]);
  });

  it('an absence entirely outside the week contributes nothing', () => {
    const dates = buildAbsenceDateSet(
      [
        { startDate: '2026-03-01', endDate: '2026-04-04' },
        { startDate: '2026-04-12', endDate: '9999-12-31' },
      ],
      WEEK,
    );
    expect(dates.size).toBe(0);
  });
});

describe('compositeWeekWindow (ROK-1842)', () => {
  it('spans weekStart to the day before weekEnd (exclusive end)', () => {
    const weekStart = new Date('2026-04-05T00:00:00.000Z');
    const weekEnd = new Date('2026-04-12T00:00:00.000Z');
    expect(compositeWeekWindow(weekStart, weekEnd)).toEqual(WEEK);
  });
});
