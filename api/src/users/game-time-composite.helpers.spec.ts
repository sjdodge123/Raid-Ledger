/**
 * ROK-1842 — the composite view's absence expansion is clamped to the week
 * being rendered. Before, `buildAbsenceDateSet` walked every day of an
 * absence's full range: a stored 0001-01-01..9999-12-31 row cost 3.64M loop
 * iterations (~4s CPU, ~270MB) on every `/users/me/game-time` read.
 */
import {
  assembleCompositeView,
  buildAbsenceDateSet,
  compositeWeekWindow,
  eventWeekWindow,
} from './game-time-composite.helpers';
import type { SignedUpEventRow } from './game-time.types';

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

const event = (startIso: string, endIso: string): SignedUpEventRow => ({
  eventId: 1,
  title: 'Raid',
  description: null,
  duration: [new Date(startIso), new Date(endIso)],
  signupId: 1,
  confirmationStatus: 'confirmed',
  gameId: null,
  gameSlug: null,
  gameName: null,
  gameCoverUrl: null,
  creatorUsername: null,
});

const view = (
  weekStartIso: string,
  weekSent: boolean,
  startIso = '2026-11-02T01:00:00.000Z',
  endIso = '2026-11-02T02:00:00.000Z',
): ReturnType<typeof assembleCompositeView> => {
  const weekStart = new Date(weekStartIso);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
  return assembleCompositeView(
    [],
    [event(startIso, endIso)],
    [],
    [],
    new Map(),
    weekStart,
    weekEnd,
    300,
    eventWeekWindow(weekStart, weekEnd, 300, weekSent),
  );
};

const committedOf = (
  v: ReturnType<typeof assembleCompositeView>,
): Array<{ dayOfWeek: number; hour: number }> =>
  v.slots
    .filter((s) => s.status === 'committed')
    .map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.hour }));

const blocksOf = (
  v: ReturnType<typeof assembleCompositeView>,
): Array<{ dayOfWeek: number; hour: number }> =>
  v.events.map((e) => ({ dayOfWeek: e.dayOfWeek, hour: e.startHour }));

const committed = (
  weekStartIso: string,
  weekSent: boolean,
): Array<{ dayOfWeek: number; hour: number }> =>
  committedOf(view(weekStartIso, weekSent));

/**
 * Tech debt (2026-10-13 backlog, ROK-1595 round 4): with no `week` sent the
 * service passes the UNSHIFTED Sunday 00:00Z, so committed slots must be
 * keyed from the viewer's local Sunday (the calendar busy hours' start),
 * not from 00:00Z — else a west-of-UTC evening event lands on the next day.
 */
describe('assembleCompositeView committed slots — week start shift', () => {
  it('no week sent: an 01:00Z event lands on the previous local day (tz +300)', () => {
    // Mon 01:00Z is Sun 20:00 at UTC-5 → day 0, hour 20 (was day 1).
    expect(committed('2026-11-01T00:00:00.000Z', false)).toEqual([
      { dayOfWeek: 0, hour: 20 },
    ]);
  });

  it('week sent: the local-Sunday week start is used unchanged', () => {
    expect(committed('2026-11-01T05:00:00.000Z', true)).toEqual([
      { dayOfWeek: 0, hour: 20 },
    ]);
  });

  it('no week sent: the event block lands on the same day/hour as its committed slot', () => {
    const v = view('2026-11-01T00:00:00.000Z', false);
    expect(blocksOf(v)).toEqual([{ dayOfWeek: 0, hour: 20 }]);
    expect(blocksOf(v)).toEqual(committedOf(v));
  });

  it("no week sent: an event in the viewer's last local Saturday hours is included", () => {
    // Sun 2026-11-08 02:00Z is Sat 21:00 at UTC-5 — past the unshifted
    // 00:00Z week end, inside the viewer's local week.
    const v = view(
      '2026-11-01T00:00:00.000Z',
      false,
      '2026-11-08T02:00:00.000Z',
      '2026-11-08T03:00:00.000Z',
    );
    expect(committedOf(v)).toEqual([{ dayOfWeek: 6, hour: 21 }]);
    expect(blocksOf(v)).toEqual([{ dayOfWeek: 6, hour: 21 }]);
  });
});

/** The event fetch, committed slots and blocks share this one window. */
describe('eventWeekWindow', () => {
  const weekStart = new Date('2026-11-01T00:00:00.000Z');
  const weekEnd = new Date('2026-11-08T00:00:00.000Z');

  it("no week sent: shifts to the viewer's local Sunday (tz +300)", () => {
    expect(eventWeekWindow(weekStart, weekEnd, 300, false)).toEqual([
      new Date('2026-11-01T05:00:00.000Z'),
      new Date('2026-11-08T05:00:00.000Z'),
    ]);
  });

  it('week sent: the window is unchanged', () => {
    expect(eventWeekWindow(weekStart, weekEnd, 300, true)).toEqual([
      weekStart,
      weekEnd,
    ]);
  });
});
