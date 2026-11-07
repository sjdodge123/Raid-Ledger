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

/** A member's level keyed by its stored row id. */
export interface LevelById {
  id: number;
  level: number | null;
}

/**
 * Pure, member-id keyed (ROK-1928: shared by the addon import and the
 * Blizzard roster sync): rows whose new level exceeds a known prior level.
 */
export function levelUpsById(
  prior: readonly LevelById[],
  next: readonly { id: number; level: number }[],
): LevelUp[] {
  const byId = new Map(prior.map((p) => [p.id, p.level]));
  return next.flatMap((n) => {
    const before = byId.get(n.id);
    if (before === undefined || before === null || n.level <= before) return [];
    return [{ guildMemberId: n.id, fromLevel: before, toLevel: n.level }];
  });
}

/** Pure: members whose new level exceeds a known, non-null prior level. */
export function levelUps(
  prior: PriorLevel[],
  members: AddonGuildMember[],
): LevelUp[] {
  const idByGuid = new Map(prior.map((p) => [p.guid, p.id]));
  const next = members.flatMap((m) => {
    const id = idByGuid.get(m.guid);
    return id === undefined ? [] : [{ id, level: m.level }];
  });
  return levelUpsById(prior, next);
}

/** Insert the dings at `occurredAt`; a repeat `(member, to_level)` is a no-op. */
export async function insertDings(
  ctx: Pick<AddonApplyContext, 'tx'>,
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
