import type { SQL } from 'drizzle-orm';
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
  /** Null for a system path (ROK-2160: a guild rejoin reactivates). */
  actorId: number | null;
  ownerId: number;
  characterId: string;
  guid: string;
  name: string;
  gameId: number;
  region: string | null;
  /**
   * ROK-2128: how the GUID was claimed — `roster_pick` = self-asserted from
   * the guild roster (FLAG 3); `admin_reassign` = an admin Change owner moved
   * the GUID-linked row to a new owner (a fresh link for ROK-1794 grants);
   * `owner_reactivated` = ROK-2160: the owner came back and their GUID won
   * back a row staff granted while they were away (`external-id.owner-status.ts`).
   */
  via?: 'roster_pick' | 'admin_reassign' | 'owner_reactivated';
  /**
   * ROK-2160 review r2 M4: the audit's `created_at`. Default (unset) is the
   * column default, NOW() = tx start; owner-status audits pass
   * `clock_timestamp()` so a grant whose tx began during a long
   * deactivation tx does not post-date the audit.
   */
  createdAt?: SQL;
}

export async function logGuidAudit(
  tx: AddonImportTx,
  entry: GuidAuditEntry,
): Promise<void> {
  const { action, actorId, ownerId, createdAt, ...rest } = entry;
  await tx.insert(schema.activityLog).values({
    entityType: GUID_AUDIT_ENTITY,
    entityId: ownerId,
    action,
    actorId,
    metadata: { ...rest, ownerId },
    ...(createdAt ? { createdAt } : {}),
  });
}
