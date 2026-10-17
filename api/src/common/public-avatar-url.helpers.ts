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
 * no Discord id, so it still passes through untouched — UNLESS it points at a
 * Discord CDN host or an `/avatars/` path, which would smuggle the snowflake
 * back in if a future writer ever stored such a string in `users.avatar`.
 * `customAvatarUrl` is projected separately and is likewise unaffected.
 */

/** Hosts whose avatar URLs embed the Discord snowflake in the path. */
const DISCORD_CDN_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
]);

/**
 * Project a stored avatar value for an anonymous viewer.
 *
 * - absolute `http(s)` URL (custom upload, any scheme casing) → returned as-is.
 * - absolute URL on a Discord CDN host (trailing-dot form included), or any
 *   URL whose decoded path contains `/avatars/` → `null` (it would carry the
 *   snowflake). Non-http(s) schemes → `null`.
 * - anything else (a Discord avatar hash, missing, empty, unparsable) → `null`.
 *
 * The Discord id is deliberately NOT a parameter: no caller can reintroduce it.
 */
export function publicAvatarUrl(
  avatar: string | null | undefined,
): string | null {
  if (!avatar) return null;
  let parsed: URL;
  try {
    parsed = new URL(avatar);
  } catch {
    return null;
  }
  // `URL` lower-cases the scheme, so `HTTP://` is fine and `httpx://` is not.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // A trailing dot (`cdn.discordapp.com.`) is the same host to DNS.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (DISCORD_CDN_HOSTS.has(host)) return null;
  // Compare the decoded path so `/%61vatars/` cannot slip past the check.
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.toLowerCase().includes('/avatars/')) return null;
  return avatar;
}
