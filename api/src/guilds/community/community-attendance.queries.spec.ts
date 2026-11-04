/**
 * ROK-2062 — the community hub leaderboard's pure sort + cap. A community
 * hub has no roster to bound the row count, so only the top
 * `COMMUNITY_ATTENDANCE_ROW_CAP` rows ship; the cap must apply AFTER the
 * sort so the leaders survive it.
 */
import type { GuildAttendanceRowDto } from '@raid-ledger/contract';
import {
  COMMUNITY_ATTENDANCE_ROW_CAP,
  rankAttendanceRows,
} from './community-attendance.queries';

function row(
  userId: number,
  name: string,
  attended: number,
): GuildAttendanceRowDto {
  return { userId, characterId: null, name, attended, of: 10 };
}

describe('rankAttendanceRows (ROK-2062)', () => {
  it('caps at 50 rows by default', () => {
    expect(COMMUNITY_ATTENDANCE_ROW_CAP).toBe(50);
    const rows = Array.from({ length: 51 }, (_, i) =>
      row(i + 1, `user-${String(i).padStart(2, '0')}`, 1),
    );

    expect(rankAttendanceRows(rows)).toHaveLength(50);
  });

  it('applies the cap after the sort, keeping the top attendees', () => {
    const rows = [
      row(1, 'low', 1),
      row(2, 'bravo', 5),
      row(3, 'Alpha', 5),
      row(4, 'top', 9),
    ];

    expect(rankAttendanceRows(rows, 3).map((r) => r.userId)).toEqual([4, 3, 2]);
  });

  it('breaks attended ties by name, case-blind', () => {
    const rows = [row(1, 'charlie', 2), row(2, 'Bravo', 2), row(3, 'alpha', 2)];

    expect(rankAttendanceRows(rows).map((r) => r.name)).toEqual([
      'alpha',
      'Bravo',
      'charlie',
    ]);
  });
});
