import { and, eq, isNull } from 'drizzle-orm';
import { guildMemberLevelEvents, guildMembers } from '../../../drizzle/schema';
import type { AddonImportTx } from '../addon-import/addon-import-apply.types';
import type { JunkMerge } from './blizzard-roster-sync.identity';

/**
 * ROK-2139 — write the planned junk-row merges inside the sync transaction:
 * the junk row's dings move to its GUID twin, the junk row is deleted, and
 * the twin takes the Blizzard id. Only GUID-less rows of this guild are ever
 * deleted, so a replay is a no-op.
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
    await tx
      .update(guildMemberLevelEvents)
      .set({ guildMemberId: m.targetId })
      .where(eq(guildMemberLevelEvents.guildMemberId, m.junkId));
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
      .set({ blizzardCharacterId: m.blizzardCharacterId })
      .where(
        and(eq(guildMembers.id, m.targetId), eq(guildMembers.guildId, guildId)),
      );
  }
}
