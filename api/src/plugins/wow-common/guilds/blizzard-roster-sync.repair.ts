import { and, eq, exists, inArray, isNull } from 'drizzle-orm';
import {
  guildEditors,
  guildMemberLevelEvents,
  guildMembers,
} from '../../../drizzle/schema';
import type { AddonImportTx } from '../addon-import/addon-import-apply.types';
import type { JunkMerge } from './blizzard-roster-sync.identity';

/**
 * Move the junk row's dings to its twin. `(guild_member_id, to_level)` is
 * unique, so the junk dings whose level the twin already has are deleted
 * first; the UPDATE then cannot collide (CLAUDE.md: pre-check, never retry).
 */
async function moveDings(tx: AddonImportTx, m: JunkMerge): Promise<void> {
  const twinLevels = tx
    .select({ toLevel: guildMemberLevelEvents.toLevel })
    .from(guildMemberLevelEvents)
    .where(eq(guildMemberLevelEvents.guildMemberId, m.targetId));
  await tx
    .delete(guildMemberLevelEvents)
    .where(
      and(
        eq(guildMemberLevelEvents.guildMemberId, m.junkId),
        inArray(guildMemberLevelEvents.toLevel, twinLevels),
      ),
    );
  await tx
    .update(guildMemberLevelEvents)
    .set({ guildMemberId: m.targetId })
    .where(eq(guildMemberLevelEvents.guildMemberId, m.junkId));
}

/**
 * Re-point the junk row's member editor grant to its twin — the delete would
 * cascade it away. `(guild_id, guild_member_id)` is unique, so a junk grant
 * is dropped when the twin already holds one (same guild, same rights).
 */
async function moveEditorGrants(
  tx: AddonImportTx,
  m: JunkMerge,
): Promise<void> {
  const twinGrant = tx
    .select({ id: guildEditors.id })
    .from(guildEditors)
    .where(eq(guildEditors.guildMemberId, m.targetId));
  await tx
    .delete(guildEditors)
    .where(and(eq(guildEditors.guildMemberId, m.junkId), exists(twinGrant)));
  await tx
    .update(guildEditors)
    .set({ guildMemberId: m.targetId })
    .where(eq(guildEditors.guildMemberId, m.junkId));
}

/**
 * ROK-2225 — the junk row's `blizzard_seen_at`, read before it is deleted so
 * its twin stays in the sync's churn baseline (else the twin counts as added).
 */
async function junkSeenAt(
  tx: AddonImportTx,
  m: JunkMerge,
): Promise<Date | null> {
  const [row] = await tx
    .select({ seen: guildMembers.blizzardSeenAt })
    .from(guildMembers)
    .where(eq(guildMembers.id, m.junkId));
  return row?.seen ?? null;
}

/**
 * ROK-2139 — write the planned junk-row merges inside the sync transaction:
 * the junk row's dings and editor grants move to its GUID twin, the junk row
 * is deleted, and the twin takes the Blizzard id (and, ROK-2225, the junk
 * row's `blizzard_seen_at` when it has one). Only GUID-less rows of
 * this guild are ever deleted, so a replay is a no-op.
 * @param tx - The sync transaction (holds the guild lock).
 * @param guildId - The guild being synced.
 * @param merges - From `planJunkMerges`.
 */
export async function writeJunkMerges(
  tx: AddonImportTx,
  guildId: number,
  merges: readonly JunkMerge[],
): Promise<void> {
  for (const m of merges) {
    await moveDings(tx, m);
    await moveEditorGrants(tx, m);
    const seen = await junkSeenAt(tx, m);
    await tx
      .delete(guildMembers)
      .where(
        and(
          eq(guildMembers.id, m.junkId),
          eq(guildMembers.guildId, guildId),
          isNull(guildMembers.guid),
        ),
      );
    await tx
      .update(guildMembers)
      .set({
        blizzardCharacterId: m.blizzardCharacterId,
        ...(seen === null ? {} : { blizzardSeenAt: seen }),
      })
      .where(
        and(eq(guildMembers.id, m.targetId), eq(guildMembers.guildId, guildId)),
      );
  }
}
