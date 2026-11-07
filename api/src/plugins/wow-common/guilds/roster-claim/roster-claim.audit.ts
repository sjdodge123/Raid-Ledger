import * as schema from '../../../../drizzle/schema';
import type { AddonImportTx } from '../../addon-import/addon-import-apply.types';

/**
 * ROK-2128 (D7) — audit trail for roster claims and admin ownership fixes,
 * in the shared `activity_log`. `entity_id` is the (new) owner's user id,
 * the same convention as `GUID_AUDIT_ENTITY`; the character id rides in
 * `metadata` because characters are uuid-keyed.
 */
export const CHARACTER_CLAIM_ENTITY = 'character_claim';

export type CharacterClaimAction =
  'roster_claimed' | 'admin_reassigned' | 'admin_unlinked_roster';

export interface CharacterClaimAuditEntry {
  action: CharacterClaimAction;
  /** The owner the row is filed under (`entity_id`). */
  ownerId: number;
  actorId: number;
  characterId: string;
  name: string;
  guildId: number | null;
  memberId: number | null;
  fromUserId: number | null;
  toUserId: number | null;
}

/** Append one `character_claim` audit row inside the caller's tx. */
export async function logCharacterClaimAudit(
  tx: AddonImportTx,
  entry: CharacterClaimAuditEntry,
): Promise<void> {
  const { action, ownerId, ...metadata } = entry;
  await tx.insert(schema.activityLog).values({
    entityType: CHARACTER_CLAIM_ENTITY,
    entityId: ownerId,
    action,
    actorId: entry.actorId,
    metadata,
  });
}
