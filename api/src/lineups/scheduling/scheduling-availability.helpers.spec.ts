/**
 * ROK-1559 — the scheduling-poll aggregate must land a Monday template in
 * the Monday grid column (1), not Sunday (0). Pins the CALL SITE, so a local
 * re-implementation that skips the remap fails here even if the shared
 * helper's own spec stays green.
 *
 * ROK-1560 — the same call site now classifies members fresh / stale /
 * unknown. The mock resolves the two queries in order: templates, then
 * `users.game_time_confirmed_at`.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { buildSchedulingAvailability } from './scheduling-availability.helpers';

describe('buildSchedulingAvailability (ROK-1559 / ROK-1560)', () => {
  let db: MockDb;
  const today = new Date();

  beforeEach(() => {
    db = createDrizzleMock();
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
