/** ROK-1756 — `POST /admin/plugins/wow/characters/:id/unlink` response. */
export interface AddonCharacterUnlinkResult {
  /** The removed character. */
  characterId: string;
  /** The user who held it. */
  userId: number;
  /** The GUID that is free again. */
  guid: string;
}
