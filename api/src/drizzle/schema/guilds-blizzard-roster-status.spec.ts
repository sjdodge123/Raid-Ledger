/**
 * ROK-1928 Codex P2-1: `guilds.blizzard_roster_status` must be wide enough
 * for every status the sync writes — `skipped_empty` (13 chars) overflowed a
 * `varchar(12)` and failed the empty-roster path with a Postgres length error.
 */
import { getTableColumns } from 'drizzle-orm';
import { PgVarchar } from 'drizzle-orm/pg-core';
import { BLIZZARD_ROSTER_STATUSES } from '@raid-ledger/contract';
import { guilds } from './guilds';

describe('guilds.blizzard_roster_status column width', () => {
  const column = getTableColumns(guilds).blizzardRosterStatus;

  /** The varchar width; fails loudly if the column stops being a varchar. */
  function width(): number {
    if (!(column instanceof PgVarchar)) throw new Error('not a varchar');
    return column.length ?? 0;
  }

  it.each([...BLIZZARD_ROSTER_STATUSES])(
    'fits the %s status',
    (status: string) => {
      expect(width()).toBe(16);
      expect(status.length).toBeLessThanOrEqual(width());
    },
  );

  it('enumerates exactly the contract statuses', () => {
    expect(column.enumValues).toEqual([...BLIZZARD_ROSTER_STATUSES]);
  });
});
