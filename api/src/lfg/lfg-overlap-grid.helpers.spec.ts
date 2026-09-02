/**
 * ROK-1463 W4/W5 — unit coverage for the grid → instants pipeline behind
 * `GET /lfg/:gameId/overlap`.
 *
 * The integration spec can only reach these through a live roster, which
 * leaves the branches that matter most untested: the `blocked` / `committed`
 * REMOVAL path, `contained` vs `touched` hour granularity, and the timezone
 * conversion that C1 turned on. This file drives them directly.
 *
 * Day-of-week (W5): the SUT's mapping is pinned against an INDEPENDENT oracle
 * (`Date.getUTCDay`) rather than a second copy of itself, so a both-sides-wrong
 * convention cannot pass.
 */
import { buildHorizon } from './lfg-overlap-grid.helpers';
import {
  absenceDates,
  applyRanges,
  buildBaseSlots,
  hoursForDay,
  hoursInRange,
  indexGrid,
  zonedDayResolver,
  type GridRows,
  type OverlapHorizon,
} from './lfg-grid-projection.helpers';
import {
  enumerateZonedDays,
  gridDayOfWeek,
  nextCalendarDay,
  zonedDayKey,
  zonedHourToUtc,
} from './lfg-zoned-time.helpers';
import type { MemberSlots } from './lfg-overlap.helpers';

const HOUR_MS = 60 * 60 * 1000;
const NEW_YORK = 'America/New_York';
const BERLIN = 'Europe/Berlin';
/** A Monday — asserted as such by the independent oracle below. */
const MONDAY = '2026-09-07';

const horizon = (startIso: string, endIso: string): OverlapHorizon => ({
  start: new Date(startIso),
  end: new Date(endIso),
});

const emptyRows = (): GridRows => ({
  templates: [],
  overrides: [],
  absences: [],
  ranges: [],
});

describe('gridDayOfWeek (W5)', () => {
  it('maps Monday to 0, against an independent oracle', () => {
    // Oracle: JS `getUTCDay()` is 0 = Sunday, so a Monday is 1.
    expect(new Date(`${MONDAY}T00:00:00Z`).getUTCDay()).toBe(1);

    expect(gridDayOfWeek(MONDAY)).toBe(0);
  });

  it('maps Sunday to 6 — the grid convention, not the events one', () => {
    const sunday = '2026-09-13';
    expect(new Date(`${sunday}T00:00:00Z`).getUTCDay()).toBe(0);

    expect(gridDayOfWeek(sunday)).toBe(6);
  });

  it('walks 0..6 across a whole week', () => {
    const week = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];
    expect(week.map(gridDayOfWeek)).toEqual([0, 1, 2, 3]);
  });
});

describe('buildHorizon', () => {
  it('rounds the start UP to the next whole hour', () => {
    const { start } = buildHorizon(new Date('2026-09-07T10:17:43.221Z'), 14);

    expect(start.toISOString()).toBe('2026-09-07T11:00:00.000Z');
  });

  it('leaves an exact hour where it is', () => {
    const { start } = buildHorizon(new Date('2026-09-07T10:00:00.000Z'), 14);

    expect(start.toISOString()).toBe('2026-09-07T10:00:00.000Z');
  });

  it('ends `days` after NOW, not after the rounded start', () => {
    const now = new Date('2026-09-07T10:17:00Z');

    const { end } = buildHorizon(now, 14);

    expect(end.getTime() - now.getTime()).toBe(14 * 24 * HOUR_MS);
  });
});

describe('zoned time', () => {
  it('converts a local hour to the matching UTC instant in summer', () => {
    // 2026-07-01 is EDT (UTC-4): 20:00 local is midnight UTC the next day.
    expect(zonedHourToUtc('2026-07-01', 20, NEW_YORK).toISOString()).toBe(
      '2026-07-02T00:00:00.000Z',
    );
  });

  it('honours the winter offset for the same local hour', () => {
    // 2026-01-15 is EST (UTC-5).
    expect(zonedHourToUtc('2026-01-15', 20, NEW_YORK).toISOString()).toBe(
      '2026-01-16T01:00:00.000Z',
    );
  });

  it('is a no-op for UTC', () => {
    expect(zonedHourToUtc(MONDAY, 9, 'UTC').toISOString()).toBe(
      '2026-09-07T09:00:00.000Z',
    );
  });

  it('places the same local hour at different instants per zone', () => {
    const ny = zonedHourToUtc(MONDAY, 20, NEW_YORK).getTime();
    const berlin = zonedHourToUtc(MONDAY, 20, BERLIN).getTime();

    expect(ny - berlin).toBe(6 * HOUR_MS);
  });

  it('reads the local calendar day of an instant', () => {
    // 01:30 UTC is still the previous evening in New York.
    expect(zonedDayKey(new Date('2026-09-08T01:30:00Z'), NEW_YORK)).toBe(
      '2026-09-07',
    );
    expect(zonedDayKey(new Date('2026-09-08T01:30:00Z'), 'UTC')).toBe(
      '2026-09-08',
    );
  });

  it('rolls the calendar day over a month boundary', () => {
    expect(nextCalendarDay('2026-09-30')).toBe('2026-10-01');
  });
});

describe('enumerateZonedDays', () => {
  const window = horizon('2026-09-07T11:00:00Z', '2026-09-10T11:00:00Z');

  it('lists every local day the horizon touches, oldest first', () => {
    const days = enumerateZonedDays(window.start, window.end, 'UTC');

    expect(days.map((d) => d.dateStr)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
    ]);
    expect(days.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3]);
  });

  it('shifts the day list for a zone behind UTC', () => {
    const days = enumerateZonedDays(
      new Date('2026-09-07T02:00:00Z'),
      new Date('2026-09-08T02:00:00Z'),
      NEW_YORK,
    );

    // 02:00 UTC on the 7th is still the 6th in New York.
    expect(days.map((d) => d.dateStr)).toEqual(['2026-09-06', '2026-09-07']);
  });

  it('excludes a day the horizon only reaches at its exclusive end', () => {
    const days = enumerateZonedDays(
      new Date('2026-09-07T00:00:00Z'),
      new Date('2026-09-08T00:00:00Z'),
      'UTC',
    );

    expect(days.map((d) => d.dateStr)).toEqual(['2026-09-07']);
  });
});

describe('absenceDates', () => {
  const days = enumerateZonedDays(
    new Date('2026-09-07T00:00:00Z'),
    new Date('2026-09-11T00:00:00Z'),
    'UTC',
  );

  it('expands an inclusive range into every day it covers', () => {
    expect(
      absenceDates({ startDate: '2026-09-08', endDate: '2026-09-09' }, days),
    ).toEqual(['2026-09-08', '2026-09-09']);
  });

  it('clamps a range that runs past the horizon', () => {
    expect(
      absenceDates({ startDate: '2026-09-01', endDate: '2026-12-31' }, days),
    ).toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  });

  it('yields nothing for a range entirely outside the horizon', () => {
    expect(
      absenceDates({ startDate: '2026-08-01', endDate: '2026-08-02' }, days),
    ).toEqual([]);
  });
});

describe('hoursForDay', () => {
  const days = enumerateZonedDays(
    new Date(`${MONDAY}T00:00:00Z`),
    new Date('2026-09-08T00:00:00Z'),
    'UTC',
  );
  const daysOf = () => days;
  const day = days[0];

  const index = (rows: Partial<GridRows>) =>
    indexGrid({ ...emptyRows(), ...rows }, daysOf);

  it('returns the recurring template hours for the weekday', () => {
    const idx = index({
      templates: [
        { userId: 1, dayOfWeek: 0, startHour: 19 },
        { userId: 1, dayOfWeek: 0, startHour: 20 },
        { userId: 1, dayOfWeek: 3, startHour: 8 },
      ],
    });

    expect([...hoursForDay(1, day, idx)].sort()).toEqual([19, 20]);
  });

  it('lets a `blocked` override remove a template hour', () => {
    const idx = index({
      templates: [{ userId: 1, dayOfWeek: 0, startHour: 19 }],
      overrides: [
        { userId: 1, date: MONDAY, hour: 19, status: 'blocked' },
      ],
    });

    expect([...hoursForDay(1, day, idx)]).toEqual([]);
  });

  it('lets an `available` override add an hour the template lacks', () => {
    const idx = index({
      overrides: [
        { userId: 1, date: MONDAY, hour: 21, status: 'available' },
      ],
    });

    expect([...hoursForDay(1, day, idx)]).toEqual([21]);
  });

  it('lets an absence outrank both the template and the overrides', () => {
    const idx = index({
      templates: [{ userId: 1, dayOfWeek: 0, startHour: 19 }],
      overrides: [
        { userId: 1, date: MONDAY, hour: 21, status: 'available' },
      ],
      absences: [{ userId: 1, startDate: MONDAY, endDate: MONDAY }],
    });

    expect([...hoursForDay(1, day, idx)]).toEqual([]);
  });
});

describe('buildBaseSlots', () => {
  const window = horizon('2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z');

  function project(zones: Map<number, string>, rows: Partial<GridRows>) {
    const merged = { ...emptyRows(), ...rows };
    const daysOf = zonedDayResolver(zones, window);
    return buildBaseSlots(zones, daysOf, indexGrid(merged, daysOf), window);
  }

  it('gives every member an entry, even with no grid at all', () => {
    const slots = project(new Map([[1, 'UTC']]), {});

    expect([...slots.keys()]).toEqual([1]);
    expect(slots.get(1)!.size).toBe(0);
  });

  it('drops an hour whose instant falls outside the horizon', () => {
    const slots = project(new Map([[1, 'UTC']]), {
      // 23:00 UTC + 1h ends exactly at the horizon end, so it survives; the
      // Sunday template (dayOfWeek 6) is a day the horizon never reaches.
      templates: [
        { userId: 1, dayOfWeek: 0, startHour: 23 },
        { userId: 1, dayOfWeek: 6, startHour: 10 },
      ],
    });

    expect([...slots.get(1)!]).toEqual(['2026-09-07T23:00:00.000Z']);
  });

  it('projects the SAME local hour in two zones onto different instants', () => {
    const slots = project(
      new Map([
        [1, NEW_YORK],
        [2, BERLIN],
      ]),
      {
        templates: [
          { userId: 1, dayOfWeek: 6, startHour: 20 },
          { userId: 2, dayOfWeek: 0, startHour: 20 },
        ],
      },
    );

    // Member 1 is in New York, where the horizon opens on Sunday the 6th;
    // their 20:00 lands at 00:00 UTC on the 7th. Member 2's Berlin Monday
    // 20:00 lands at 18:00 UTC. Reading both as "20:00" would collide them.
    expect([...slots.get(1)!]).toEqual(['2026-09-07T00:00:00.000Z']);
    expect([...slots.get(2)!]).toEqual(['2026-09-07T18:00:00.000Z']);
  });
});

describe('hoursInRange', () => {
  const window = horizon('2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z');
  const range = (from: string, to: string): [Date, Date] => [
    new Date(from),
    new Date(to),
  ];

  it('yields only WHOLE hours in `contained` mode', () => {
    expect(
      hoursInRange(
        range('2026-09-07T19:30:00Z', '2026-09-07T22:00:00Z'),
        window,
        'contained',
      ),
    ).toEqual([
      '2026-09-07T20:00:00.000Z',
      '2026-09-07T21:00:00.000Z',
    ]);
  });

  it('yields every TOUCHED hour in `touched` mode', () => {
    expect(
      hoursInRange(
        range('2026-09-07T20:30:00Z', '2026-09-07T20:45:00Z'),
        window,
        'touched',
      ),
    ).toEqual(['2026-09-07T20:00:00.000Z']);
  });

  it('clamps both modes to the horizon', () => {
    expect(
      hoursInRange(
        range('2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z'),
        horizon('2026-09-07T00:00:00Z', '2026-09-07T02:00:00Z'),
        'contained',
      ),
    ).toEqual([
      '2026-09-07T00:00:00.000Z',
      '2026-09-07T01:00:00.000Z',
    ]);
  });

  it('returns nothing when the range is shorter than an hour boundary', () => {
    expect(
      hoursInRange(
        range('2026-09-07T20:10:00Z', '2026-09-07T20:50:00Z'),
        window,
        'contained',
      ),
    ).toEqual([]);
  });
});

describe('applyRanges', () => {
  const window = horizon('2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z');
  const GAME = 42;
  const HOUR_20 = '2026-09-07T20:00:00.000Z';
  const HOUR_21 = '2026-09-07T21:00:00.000Z';

  const slotsWith = (hours: string[]): MemberSlots =>
    new Map([[1, new Set(hours)]]);

  const row = (
    status: string,
    from: string,
    to: string,
    gameId: number | null = null,
  ): GridRows['ranges'][number] => ({
    userId: 1,
    timeRange: [new Date(from), new Date(to)],
    status,
    gameId,
  });

  it('adds hours an `available` row fully covers', () => {
    const slots = slotsWith([]);

    applyRanges(
      slots,
      [row('available', '2026-09-07T20:00:00Z', '2026-09-07T22:00:00Z')],
      window,
      GAME,
    );

    expect([...slots.get(1)!].sort()).toEqual([HOUR_20, HOUR_21]);
  });

  it('removes an hour a `blocked` row merely touches', () => {
    const slots = slotsWith([HOUR_20, HOUR_21]);

    applyRanges(
      slots,
      [row('blocked', '2026-09-07T20:30:00Z', '2026-09-07T20:45:00Z')],
      window,
      GAME,
    );

    expect([...slots.get(1)!]).toEqual([HOUR_21]);
  });

  it('removes an hour a `committed` row covers', () => {
    const slots = slotsWith([HOUR_20]);

    applyRanges(
      slots,
      [row('committed', '2026-09-07T20:00:00Z', '2026-09-07T21:00:00Z')],
      window,
      GAME,
    );

    expect(slots.get(1)!.size).toBe(0);
  });

  it('applies removals AFTER additions, so a removal always wins', () => {
    const slots = slotsWith([]);

    applyRanges(
      slots,
      [
        row('committed', '2026-09-07T20:00:00Z', '2026-09-07T21:00:00Z'),
        row('available', '2026-09-07T20:00:00Z', '2026-09-07T22:00:00Z'),
      ],
      window,
      GAME,
    );

    expect([...slots.get(1)!]).toEqual([HOUR_21]);
  });

  it('ignores a `freed` row entirely', () => {
    const slots = slotsWith([]);

    applyRanges(
      slots,
      [row('freed', '2026-09-07T20:00:00Z', '2026-09-07T22:00:00Z')],
      window,
      GAME,
    );

    expect(slots.get(1)!.size).toBe(0);
  });

  it('adds an `available` row scoped to the game being read', () => {
    const slots = slotsWith([]);

    applyRanges(
      slots,
      [row('available', '2026-09-07T20:00:00Z', '2026-09-07T21:00:00Z', GAME)],
      window,
      GAME,
    );

    expect([...slots.get(1)!]).toEqual([HOUR_20]);
  });

  it('ignores an `available` row scoped to a DIFFERENT game (W2)', () => {
    const slots = slotsWith([]);

    applyRanges(
      slots,
      [
        row(
          'available',
          '2026-09-07T20:00:00Z',
          '2026-09-07T21:00:00Z',
          GAME + 1,
        ),
      ],
      window,
      GAME,
    );

    expect(slots.get(1)!.size).toBe(0);
  });

  it('still removes a `blocked` row scoped to another game — busy is busy', () => {
    const slots = slotsWith([HOUR_20]);

    applyRanges(
      slots,
      [
        row(
          'blocked',
          '2026-09-07T20:00:00Z',
          '2026-09-07T21:00:00Z',
          GAME + 1,
        ),
      ],
      window,
      GAME,
    );

    expect(slots.get(1)!.size).toBe(0);
  });

  it('ignores rows for a user who is not on the roster', () => {
    const slots = slotsWith([]);

    applyRanges(
      slots,
      [
        {
          userId: 999,
          timeRange: [
            new Date('2026-09-07T20:00:00Z'),
            new Date('2026-09-07T21:00:00Z'),
          ],
          status: 'available',
          gameId: null,
        },
      ],
      window,
      GAME,
    );

    expect([...slots.keys()]).toEqual([1]);
    expect(slots.get(1)!.size).toBe(0);
  });
});
