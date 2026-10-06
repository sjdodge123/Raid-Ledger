/**
 * Server-side Discord avatar URL builder (ROK-1629).
 *
 * Public roster projections send anonymous viewers an absolute avatar URL
 * instead of the raw `discordId` + avatar hash pair. Mirrors the web helper
 * `buildDiscordAvatarUrl` / `isDiscordLinked` (`web/src/lib/avatar.ts`).
 */
const DISCORD_CDN_AVATARS = 'https://cdn.discordapp.com/avatars';

/** True for a real Discord snowflake — false for `local:` / `unlinked:` placeholders. */
function isLinkedDiscordId(discordId: string | null | undefined): boolean {
  return Boolean(
    discordId &&
    !discordId.startsWith('local:') &&
    !discordId.startsWith('unlinked:'),
  );
}

/**
 * Build an absolute Discord CDN avatar URL.
 * - `avatar` already an absolute `http(s)` URL → returned as-is (no id needed).
 * - missing hash, missing id, or a `local:` / `unlinked:` id → `null`.
 */
export function discordAvatarUrl(
  discordId: string | null | undefined,
  avatar: string | null | undefined,
): string | null {
  if (!avatar) return null;
  if (avatar.startsWith('http')) return avatar;
  if (!isLinkedDiscordId(discordId)) return null;
  return `${DISCORD_CDN_AVATARS}/${discordId}/${avatar}.png`;
}
