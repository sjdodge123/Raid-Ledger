import type { GuildRoleCounts } from '@raid-ledger/contract';
import { effectiveRole, type RawRosterRow } from './guild-roster.helpers';

/**
 * ROK-1785 — the guild's role mix, ONE count per linked RL user so alts do
 * not double-count. Each user is represented by their main (`isMain`) in this
 * guild, else their highest-rank (lowest index) character. Unlinked members
 * are not counted; a linked character with no role counts as `unknown`.
 */
export function computeRoleCounts(
  rows: readonly RawRosterRow[],
): GuildRoleCounts {
  const counts: GuildRoleCounts = { tank: 0, healer: 0, dps: 0, unknown: 0 };
  for (const row of representativeRows(rows)) {
    counts[effectiveRole(row) ?? 'unknown'] += 1;
  }
  return counts;
}

/** One linked row per user: main first, then the best rank. */
function representativeRows(rows: readonly RawRosterRow[]): RawRosterRow[] {
  const byUser = new Map<number, RawRosterRow>();
  for (const row of rows) {
    if (row.userId === null || row.characterId === null) continue;
    const prev = byUser.get(row.userId);
    if (!prev || outranks(row, prev)) byUser.set(row.userId, row);
  }
  return [...byUser.values()];
}

function outranks(a: RawRosterRow, b: RawRosterRow): boolean {
  const aMain = a.isMain === true;
  if (aMain !== (b.isMain === true)) return aMain;
  return rankOf(a) < rankOf(b);
}

function rankOf(row: RawRosterRow): number {
  return row.rankIndex ?? Number.MAX_SAFE_INTEGER;
}
