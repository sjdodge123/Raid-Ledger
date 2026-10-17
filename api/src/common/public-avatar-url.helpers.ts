/**
 * Avatar projection for anonymous viewers (ROK-1629, tightened by ROK-1827).
 *
 * ROK-1629 replaced the raw `discordId` + avatar-hash pair with a server-built
 * `https://cdn.discordapp.com/avatars/<discordId>/<hash>.png` URL. That URL
 * still *contains* the Discord snowflake, so it re-exposed the very id the
 * story hid (ROK-1827). Operator ruling 2026-10-17, option (a): an anonymous
 * response carries NO Discord-CDN avatar URL at all — the UI falls back to
 * initials. Signed-in members keep today's payload unchanged.
 *
 * An avatar that is ALREADY an absolute `http(s)` URL (a custom upload) carries
 * no Discord id, so it still passes through untouched. `customAvatarUrl` is
 * projected separately and is likewise unaffected.
 */

/**
 * Project a stored avatar value for an anonymous viewer.
 *
 * - absolute `http(s)` URL (custom upload) → returned as-is.
 * - anything else (a Discord avatar hash, missing, empty) → `null`.
 *
 * The Discord id is deliberately NOT a parameter: no caller can reintroduce it.
 */
export function publicAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  return avatar.startsWith('http') ? avatar : null;
}
