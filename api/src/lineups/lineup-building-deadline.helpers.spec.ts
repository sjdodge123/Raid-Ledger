/**
 * ROK-1443 — the building-deadline floor decision (T1).
 *
 * `decideBuildingDeadline` is the only branch logic in the fix, so it carries
 * the cheap unit tier. The constant is pinned here so a silent drift fails
 * fast rather than inside an integration run.
 */
import {
  BUILDING_DEADLINE_MIN_NOMINATIONS,
  decideBuildingDeadline,
  type BuildingDeadlineOutcome,
} from './lineup-building-deadline.helpers';

describe('decideBuildingDeadline (ROK-1443)', () => {
  it('pins the floor at two nominations (operator ruling 2026-09-06)', () => {
    expect(BUILDING_DEADLINE_MIN_NOMINATIONS).toBe(2);
  });

  const table: [number, boolean, BuildingDeadlineOutcome][] = [
    [0, false, 'extend'],
    [1, false, 'extend'],
    [2, false, 'advance'],
    [7, false, 'advance'],
    [0, true, 'abort'],
    [1, true, 'abort'],
    [2, true, 'advance'],
    [5, true, 'advance'],
  ];

  it.each(table)(
    'count=%i alreadyExtended=%s → %s',
    (count, alreadyExtended, expected) => {
      expect(decideBuildingDeadline(count, alreadyExtended)).toBe(expected);
    },
  );
});
