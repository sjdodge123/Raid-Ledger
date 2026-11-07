/**
 * ROK-1928 Codex P2-1: `guilds.blizzard_roster_status` must be wide enough
 * for every status the sync writes — `skipped_empty` (13 chars) overflowed a
 * `varchar(12)` and failed the empty-roster path with a Postgres length error.
 */
import { getTableColumns } from 'drizzle-orm';
import { BLIZZARD_ROSTER_STATUSES } from '@raid-ledger/contract';
import { guilds } from './guilds';

describe('guilds.blizzard_roster_status column width', () => {
  const column = getTableColumns(guilds).blizzardRosterStatus;

  it.each([...BLIZZARD_ROSTER_STATUSES])(
    'fits the %s status',
    (status: string) => {
      expect(column.length).toBe(16);
      expect(status.length).toBeLessThanOrEqual(column.length ?? 0);
    },
  );

  it('enumerates exactly the contract statuses', () => {
    expect(column.enumValues).toEqual([...BLIZZARD_ROSTER_STATUSES]);
  });
});
