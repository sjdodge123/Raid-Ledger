/**
 * ROK-1559 — the scheduling-poll aggregate must land a Monday template in
 * the Monday grid column (1), not Sunday (0). Pins the CALL SITE, so a local
 * re-implementation that skips the remap fails here even if the shared
 * helper's own spec stays green.
 *
 * ROK-1560 — the same call site now classifies members fresh / stale /
 * unknown. The mock resolves the two queries in order: templates, then
 * `users.game_time_confirmed_at`.
 *
 * ROK-1570 — and TWO more after those: active event signups joined to their
 * events, then absences. `db.where` defaults to `[]` so the pre-ROK-1570 cases
 * keep their two-value `mockResolvedValueOnce` chains unchanged.
 */
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { buildSchedulingAvailability } from './scheduling-availability.helpers';
import { fetchBusyKeys } from './scheduling-availability-busy.helpers';

describe('buildSchedulingAvailability (ROK-1559 / ROK-1560)', () => {
  let db: MockDb;
  const today = new Date();

  beforeEach(() => {
    db = createDrizzleMock();
    // Queries beyond the ones a case cares about resolve empty rather than
    // returning the chain mock itself.
    db.where.mockResolvedValue([]);
  });

  function daysAgo(days: number): Date {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return d;
  }

  it('paints a Monday-evening template in grid column 1 (0 = Sunday)', async () => {
    db.where
      .mockResolvedValueOnce([{ userId: 7, dayOfWeek: 0, startHour: 20 }])
      .mockResolvedValueOnce([
        { userId: 7, confirmedAt: today },
        { userId: 8, confirmedAt: today },
      ]);

    const res = await buildSchedulingAvailability(db as never, [7, 8], 42);

    expect(res.cells).toEqual([
      {
        dayOfWeek: 1,
        hour: 20,
        availableCount: 1,
        totalCount: 2,
        staleCount: 0,
        unknownCount: 1,
      },
    ]);
    expect(res.eventId).toBe(42);
    expect(res.totalUsers).toBe(2);
    expect(res.totalMembers).toBe(2);
    expect(res.freshnessDays).toBe(14);
    expect(res.untemplatedMembers).toBe(1);
  });

  it('paints a Sunday template in grid column 0', async () => {
    db.where
      .mockResolvedValueOnce([{ userId: 7, dayOfWeek: 6, startHour: 10 }])
      .mockResolvedValueOnce([{ userId: 7, confirmedAt: today }]);

    const res = await buildSchedulingAvailability(db as never, [7], 42);

    expect(res.cells).toEqual([
      {
        dayOfWeek: 0,
        hour: 10,
        availableCount: 1,
        totalCount: 1,
        staleCount: 0,
        unknownCount: 0,
      },
    ]);
  });

  // ROK-1560: pre-change this returned availableCount 1 — a 30-day-old
  // template counted as confirmed availability.
  it('counts a stale member as hatch, never as available', async () => {
    db.where
      .mockResolvedValueOnce([{ userId: 7, dayOfWeek: 0, startHour: 20 }])
      .mockResolvedValueOnce([{ userId: 7, confirmedAt: daysAgo(30) }]);

    const res = await buildSchedulingAvailability(db as never, [7], 42);

    expect(res.cells[0].availableCount).toBe(0);
    expect(res.cells[0].staleCount).toBe(1);
  });

  it('reports the viewer game-time age in whole days', async () => {
    db.where
      .mockResolvedValueOnce([{ userId: 7, dayOfWeek: 0, startHour: 20 }])
      .mockResolvedValueOnce([
        { userId: 7, confirmedAt: today },
        { userId: 9, confirmedAt: daysAgo(3) },
      ]);

    const res = await buildSchedulingAvailability(db as never, [7], 42, 9);

    expect(res.viewerGameTimeAgeDays).toBe(3);
    expect(res.viewerGameTimeStale).toBe(false);
  });

  it('returns an empty heatmap without querying when there are no members', async () => {
    const res = await buildSchedulingAvailability(db as never, [], 42);

    expect(res).toEqual({
      eventId: 42,
      totalUsers: 0,
      cells: [],
      totalMembers: 0,
      freshnessDays: 14,
      untemplatedMembers: 0,
      // no viewer in the request → both viewer fields absent (not null)
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});

/**
 * ROK-1570 — the aggregate paints a member FREE at an hour they are already
 * committed. The heatmap is a recurring week, so it is now painted for ONE
 * concrete week and dated signups/absences are subtracted from the templates
 * before the cells are counted. Busy, not unknown: the member still HAS a
 * template, so `unknownCount` must not move.
 *
 * Mock order for these cases: templates, confirmedAt, signups, absences.
 */
describe('buildSchedulingAvailability — busy subtraction (ROK-1570)', () => {
  let db: MockDb;
  const today = new Date();
  /** Sunday 2026-09-13 00:00 UTC — grid day 0 of the target week. */
  const WEEK_START = new Date(Date.UTC(2026, 8, 13));
  /** Tuesday of that week = grid day 2. */
  const TUESDAY = (hour: number, minute = 0): Date =>
    new Date(Date.UTC(2026, 8, 15, hour, minute));

  /** Both members templated Tue (DB day 1 = Monday-based) at 20:00 and 21:00. */
  const TUESDAY_TEMPLATES = [
    { userId: 7, dayOfWeek: 1, startHour: 20 },
    { userId: 7, dayOfWeek: 1, startHour: 21 },
    { userId: 8, dayOfWeek: 1, startHour: 20 },
    { userId: 8, dayOfWeek: 1, startHour: 21 },
  ];
  const BOTH_FRESH = [
    { userId: 7, confirmedAt: today },
    { userId: 8, confirmedAt: today },
  ];

  beforeEach(() => {
    db = createDrizzleMock();
    db.where.mockResolvedValue([]);
  });

  function cell(
    cells: AggregateGameTimeResponse['cells'],
    hour: number,
  ): AggregateGameTimeResponse['cells'][number] | undefined {
    return cells.find((c) => c.dayOfWeek === 2 && c.hour === hour);
  }

  it('does not count a member as available at an hour they are signed up for', async () => {
    db.where
      .mockResolvedValueOnce(TUESDAY_TEMPLATES)
      .mockResolvedValueOnce(BOTH_FRESH)
      .mockResolvedValueOnce([
        { userId: 7, duration: [TUESDAY(21), TUESDAY(22)] },
      ])
      .mockResolvedValueOnce([]);

    const res = await buildSchedulingAvailability(
      db as never,
      [7, 8],
      42,
      undefined,
      WEEK_START,
    );

    expect(cell(res.cells, 21)?.availableCount).toBe(1);
    expect(cell(res.cells, 20)?.availableCount).toBe(2);
    expect(cell(res.cells, 21)?.staleCount).toBe(0);
    expect(cell(res.cells, 21)?.unknownCount).toBe(0);
  });

  it('does not count a member absent for the whole target week on any cell', async () => {
    db.where
      .mockResolvedValueOnce(TUESDAY_TEMPLATES)
      .mockResolvedValueOnce(BOTH_FRESH)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { userId: 7, startDate: '2026-09-13', endDate: '2026-09-19' },
      ]);

    const res = await buildSchedulingAvailability(
      db as never,
      [7, 8],
      42,
      undefined,
      WEEK_START,
    );

    expect(cell(res.cells, 20)?.availableCount).toBe(1);
    expect(cell(res.cells, 21)?.availableCount).toBe(1);
    expect(cell(res.cells, 21)?.unknownCount).toBe(0);
    expect(res.untemplatedMembers).toBe(0);
  });

  it('leaves the week alone when the signup lands in a DIFFERENT week', async () => {
    db.where
      .mockResolvedValueOnce(TUESDAY_TEMPLATES)
      .mockResolvedValueOnce(BOTH_FRESH)
      .mockResolvedValueOnce([
        {
          userId: 7,
          duration: [
            new Date(Date.UTC(2026, 8, 22, 21)),
            new Date(Date.UTC(2026, 8, 22, 22)),
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    const res = await buildSchedulingAvailability(
      db as never,
      [7, 8],
      42,
      undefined,
      WEEK_START,
    );

    expect(cell(res.cells, 21)?.availableCount).toBe(2);
  });

  it('echoes the week the cells describe', async () => {
    db.where
      .mockResolvedValueOnce(TUESDAY_TEMPLATES)
      .mockResolvedValueOnce(BOTH_FRESH);

    const res = await buildSchedulingAvailability(
      db as never,
      [7, 8],
      42,
      undefined,
      WEEK_START,
    );

    expect(res.weekStart).toBe('2026-09-13T00:00:00.000Z');
  });

  it('defaults to the Sunday 00:00 UTC start of the current week', async () => {
    db.where
      .mockResolvedValueOnce(TUESDAY_TEMPLATES)
      .mockResolvedValueOnce(BOTH_FRESH);

    const res = await buildSchedulingAvailability(db as never, [7, 8], 42);

    const start = new Date(res.weekStart as string);
    expect(start.getUTCDay()).toBe(0);
    expect(start.getUTCHours()).toBe(0);
    expect(Date.now() - start.getTime()).toBeLessThan(7 * 24 * 60 * 60 * 1000);
  });

  it('keys a 20:30-22:15 signup to the whole hours it actually occupies', async () => {
    db.where
      .mockResolvedValueOnce([
        { userId: 7, duration: [TUESDAY(20, 30), TUESDAY(22, 15)] },
      ])
      .mockResolvedValueOnce([]);

    const busy = await fetchBusyKeys(
      db as never,
      [7],
      WEEK_START,
      new Date(Date.UTC(2026, 8, 20)),
    );

    expect(Array.from(busy.get(7) ?? []).sort()).toEqual(['2:21', '2:22']);
  });

  it('marks every hour of every covered day busy for an absence', async () => {
    db.where
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { userId: 7, startDate: '2026-09-14', endDate: '2026-09-15' },
      ]);

    const busy = await fetchBusyKeys(
      db as never,
      [7],
      WEEK_START,
      new Date(Date.UTC(2026, 8, 20)),
    );

    const keys = busy.get(7) ?? new Set<string>();
    expect(keys.size).toBe(48);
    expect(keys.has('1:0')).toBe(true);
    expect(keys.has('2:23')).toBe(true);
    expect(keys.has('3:0')).toBe(false);
  });
});
