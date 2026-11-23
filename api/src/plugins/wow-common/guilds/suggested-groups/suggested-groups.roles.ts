import type { SuggestedGroupRole } from '@raid-ledger/contract';
import type { InsightRow } from '../roster-insights/roster-insights.types';

/**
 * ROK-2212 — identity and role lookups for the Suggested groups pool.
 * Pure: reads only the roster row the roster-insights loader produced.
 */

const PLAYABLE_ROLES: readonly SuggestedGroupRole[] = ['tank', 'healer', 'dps'];

/**
 * The roles a character can fill — the resolved `role` fact (manual override,
 * else Armory/synced, else gap-fill). A LIST (ruling 4): one role today; once
 * dual spec is tracked this returns both specs' roles. Unknown → `[]`.
 */
export function rolesOf(row: InsightRow): SuggestedGroupRole[] {
  const role = row.facts?.role?.value;
  return PLAYABLE_ROLES.filter((r) => r === role);
}

/**
 * The dungeon planner's token text for a row: the character uuid when
 * claimed, else `m<memberId>`. Null = the row has neither (never on a
 * `wow_guild` roster).
 */
export function memberKey(row: InsightRow): string | null {
  if (row.characterId !== null) return row.characterId;
  const memberId = row.memberId ?? null;
  return memberId === null ? null : `m${memberId}`;
}

/**
 * Who plays the row: `u<userId>` for an owned character (so a user's alts
 * are one player), else the row's own member key — an unclaimed row is its
 * own player and is never merged with another row, whatever its name.
 */
export function playerKey(row: InsightRow): string | null {
  if (row.userId !== null) return `u${row.userId}`;
  return memberKey(row);
}
