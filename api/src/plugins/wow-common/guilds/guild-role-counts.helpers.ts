import type { GuildRoleCounts } from '@raid-ledger/contract';
import { effectiveRole, type RawRosterRow } from './guild-roster.helpers';

/**
 * ROK-1785 / ROK-2158 — the guild's role mix: ONE count per linked RL user
 * (so alts do not double-count) PLUS one per unlinked roster member. Each
 * user is represented by their main (`isMain`) in this guild, else their
 * highest-rank (lowest index) character. The role is {@link effectiveRole}
 * (override → Armory → character role); a member with none counts `unknown`.
 */
export function computeRoleCounts(
  rows: readonly RawRosterRow[],
): GuildRoleCounts {
  const counts: GuildRoleCounts = { tank: 0, healer: 0, dps: 0, unknown: 0 };
  for (const row of roleCountRows(rows)) {
    counts[effectiveRole(row) ?? 'unknown'] += 1;
  }
  return counts;
}

/** The identity fields {@link roleCountRows} needs from a roster row. */
export interface RoleCountableRow {
  userId: number | null;
  characterId: string | null;
  /** `guild_members.id`; null/absent rows (no roster member) never dedupe. */
  memberId?: number | null;
  isMain: boolean | null;
  rankIndex: number | null;
}

/**
 * ROK-2158 — the rows a role count counts: one per linked user (main first,
 * then the best rank) plus one per unlinked roster member (by `memberId`).
 * Shared by the guild page's `roleCounts` and roster insights' role mix.
 */
export function roleCountRows<T extends RoleCountableRow>(
  rows: readonly T[],
): T[] {
  const byUser = new Map<number, T>();
  const unlinked = new Map<number, T>();
  const keyless: T[] = [];
  for (const row of rows) {
    if (row.userId === null || row.characterId === null) {
      const memberId = row.memberId ?? null;
      if (memberId === null) keyless.push(row);
      else if (!unlinked.has(memberId)) unlinked.set(memberId, row);
      continue;
    }
    const prev = byUser.get(row.userId);
    if (!prev || outranks(row, prev)) byUser.set(row.userId, row);
  }
  return [...byUser.values(), ...unlinked.values(), ...keyless];
}

function outranks(a: RoleCountableRow, b: RoleCountableRow): boolean {
  const aMain = a.isMain === true;
  if (aMain !== (b.isMain === true)) return aMain;
  return rankOf(a) < rankOf(b);
}

function rankOf(row: RoleCountableRow): number {
  return row.rankIndex ?? Number.MAX_SAFE_INTEGER;
}
