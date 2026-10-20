/**
 * ROK-1870 A2: "in the community Discord" = a linked Discord account the bot
 * has seen in the guild (`guild_member_seen_at`), on an active RL account.
 * Staff bypass the check at the call site.
 */
export interface DiscordGuildMemberFields {
  discordId: string | null;
  guildMemberSeenAt: Date | null;
  deactivatedAt: Date | null;
}

/** `local:` (no Discord) / `unlinked:` (unlinked) ids are not a real link. */
const PLACEHOLDER_PREFIXES = ['local:', 'unlinked:'];

/** True for a real linked Discord id (OQ-6). */
function isLinkedDiscordId(id: string | null): boolean {
  return id !== null && !PLACEHOLDER_PREFIXES.some((p) => id.startsWith(p));
}

/** True when the user may Join / Propose community hubs (A2). */
export function isInDiscordGuild(user: DiscordGuildMemberFields): boolean {
  return (
    isLinkedDiscordId(user.discordId) &&
    user.guildMemberSeenAt !== null &&
    user.deactivatedAt === null
  );
}
