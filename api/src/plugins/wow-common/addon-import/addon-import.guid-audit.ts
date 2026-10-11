import * as schema from '../../../drizzle/schema';
import type { AddonImportTx } from './addon-import-apply.types';

/**
 * ROK-1756 (option B) — audit trail for in-game GUID ownership. The GUID in
 * an export is unsigned, so the first claim and any admin unlink are logged
 * to the shared `activity_log` (no new table). `entity_id` is the
 * character OWNER's user id (the column is an integer; characters are
 * uuid-keyed, so the character id rides in `metadata`).
 */
export const GUID_AUDIT_ENTITY = 'addon_guid';

export type GuidAuditAction =
  'addon_guid_claimed' | 'addon_guid_admin_unlinked';

export interface GuidAuditEntry {
  action: GuidAuditAction;
  actorId: number;
  ownerId: number;
  characterId: string;
  guid: string;
  name: string;
  gameId: number;
  region: string | null;
}

export async function logGuidAudit(
  tx: AddonImportTx,
  entry: GuidAuditEntry,
): Promise<void> {
  const { action, actorId, ownerId, ...rest } = entry;
  await tx.insert(schema.activityLog).values({
    entityType: GUID_AUDIT_ENTITY,
    entityId: ownerId,
    action,
    actorId,
    metadata: { ...rest, ownerId },
  });
}
