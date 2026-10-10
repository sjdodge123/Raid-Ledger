/**
 * ROK-1756 — `POST /admin/plugins/wow/characters/:id/unlink` response.
 * Never carries the GUID (it stays server-side, in the audit row only).
 */
export interface AddonCharacterUnlinkResult {
  /** The removed character. */
  characterId: string;
  /** The user who held it. */
  userId: number;
}
