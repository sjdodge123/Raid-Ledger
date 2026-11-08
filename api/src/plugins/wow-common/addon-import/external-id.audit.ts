import * as schema from '../../../drizzle/schema';
import type { AddonImportTx } from './addon-import-apply.types';
import { GUID_AUDIT_ENTITY } from './addon-import.guid-audit';

/**
 * ROK-2115 (Ruling 5) — the moment a character's Blizzard-character-id link
 * (`characters.external_id`) came into being, for ROK-1794 member grants.
 * Same `activity_log` entity as `addon_guid_claimed` (`entity_id` = the
 * character OWNER); `linkConfirmedAt` / `hasConfirmedMemberGrant` read it.
 * Never the Armory sync time: that moves hourly and would revoke grants.
 */
export const EXTERNAL_ID_LINKED_ACTION = 'external_id_linked';

/** Where the id was set: an Armory (re-)import merge, ROK-2124's auto-link,
 * a ROK-2128 roster pick, or an admin Change owner (a fresh owner's link). */
export type ExternalIdLinkVia =
  | 'armory_import'
  | 'auto_link'
  | 'roster_pick'
  | 'admin_reassign';

export interface ExternalIdLinkEntry {
  /** Null for a background job (auto-link). */
  actorId: number | null;
  ownerId: number;
  characterId: string;
  /** The id the character carries after the write. */
  externalId: string | null;
  gameId: number;
  region: string | null;
  via: ExternalIdLinkVia;
}

/**
 * Log only a real link: an id is set and it differs from the previous one.
 * An admin reassign is always a fresh link for the new owner (the id is
 * unchanged, the owner is not) — pass `previous: null` for it.
 */
export function isExternalIdLinkChange(
  next: string | null | undefined,
  previous: string | null | undefined,
): next is string {
  return typeof next === 'string' && next !== '' && next !== (previous ?? null);
}

/**
 * Write `external_id_linked` when `entry.externalId` is set and differs from
 * `previous`. @returns whether a row was written.
 */
export async function logExternalIdLinked(
  tx: AddonImportTx,
  entry: ExternalIdLinkEntry,
  previous: string | null | undefined,
): Promise<boolean> {
  if (!isExternalIdLinkChange(entry.externalId, previous)) return false;
  const { actorId, ownerId, ...rest } = entry;
  await tx.insert(schema.activityLog).values({
    entityType: GUID_AUDIT_ENTITY,
    entityId: ownerId,
    action: EXTERNAL_ID_LINKED_ACTION,
    actorId,
    metadata: { ...rest, ownerId },
  });
  return true;
}
