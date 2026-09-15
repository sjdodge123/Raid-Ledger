/**
 * ROK-1559 — the scheduling-poll aggregate must land a Monday template in
 * the Monday grid column (1), not Sunday (0). Pins the CALL SITE, so a local
 * re-implementation that skips the remap fails here even if the shared
 * helper's own spec stays green.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { buildSchedulingAvailability } from './scheduling-availability.helpers';

describe('buildSchedulingAvailability (ROK-1559)', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('paints a Monday-evening template in grid column 1 (0 = Sunday)', async () => {
    db.where.mockResolvedValue([{ userId: 7, dayOfWeek: 0, startHour: 20 }]);

    const res = await buildSchedulingAvailability(db as never, [7, 8], 42);

    expect(res).toEqual({
      eventId: 42,
      totalUsers: 2,
      cells: [{ dayOfWeek: 1, hour: 20, availableCount: 1, totalCount: 2 }],
    });
  });

  it('paints a Sunday template in grid column 0', async () => {
    db.where.mockResolvedValue([{ userId: 7, dayOfWeek: 6, startHour: 10 }]);

    const res = await buildSchedulingAvailability(db as never, [7], 42);

    expect(res.cells).toEqual([
      { dayOfWeek: 0, hour: 10, availableCount: 1, totalCount: 1 },
    ]);
  });

  it('returns an empty heatmap without querying when there are no members', async () => {
    const res = await buildSchedulingAvailability(db as never, [], 42);

    expect(res).toEqual({ eventId: 42, totalUsers: 0, cells: [] });
    expect(db.select).not.toHaveBeenCalled();
  });
});
