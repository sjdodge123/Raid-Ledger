import { and, eq, inArray } from 'drizzle-orm';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { guildMemberLevelEvents, guildMembers } from '../../../drizzle/schema';
import type { AddonApplyContext } from './addon-import-apply.types';

/**
 * ROK-1919: log level-ups ("dings") seen by a LedgerLink guild re-import.
 * Prior levels are read BEFORE the member upsert, inside the same import
 * transaction; only existing members whose level rose are logged (no
 * baseline for a first import or a newly-joined member).
 */

/** A stored member's level before this import. */
export interface PriorLevel {
  id: number;
  guid: string;
  level: number | null;
}

/** One level-up: a multi-level jump is ONE event (D3). */
export interface LevelUp {
  guildMemberId: number;
  fromLevel: number;
  toLevel: number;
}

/** Stored `(id, guid, level)` for the payload's guids in this guild. */
export async function loadPriorLevels(
  ctx: AddonApplyContext,
  guildId: number,
  guids: string[],
): Promise<PriorLevel[]> {
  if (guids.length === 0) return [];
  const rows = await ctx.tx
    .select({
      id: guildMembers.id,
      guid: guildMembers.guid,
      level: guildMembers.level,
    })
    .from(guildMembers)
    .where(
      and(eq(guildMembers.guildId, guildId), inArray(guildMembers.guid, guids)),
    );
  return rows.flatMap((r) => (r.guid === null ? [] : [{ ...r, guid: r.guid }]));
}

/** Pure: members whose new level exceeds a known, non-null prior level. */
export function levelUps(
  prior: PriorLevel[],
  members: AddonGuildMember[],
): LevelUp[] {
  const byGuid = new Map(prior.map((p) => [p.guid, p]));
  return members.flatMap((m) => {
    const before = byGuid.get(m.guid);
    if (!before || before.level === null || m.level <= before.level) return [];
    return [
      { guildMemberId: before.id, fromLevel: before.level, toLevel: m.level },
    ];
  });
}

/** Insert the dings at `occurredAt`; a repeat `(member, to_level)` is a no-op. */
export async function insertDings(
  ctx: AddonApplyContext,
  guildId: number,
  dings: LevelUp[],
  occurredAt: Date,
): Promise<void> {
  if (dings.length === 0) return;
  await ctx.tx
    .insert(guildMemberLevelEvents)
    .values(dings.map((d) => ({ ...d, guildId, occurredAt })))
    .onConflictDoNothing({
      target: [
        guildMemberLevelEvents.guildMemberId,
        guildMemberLevelEvents.toLevel,
      ],
    });
}
