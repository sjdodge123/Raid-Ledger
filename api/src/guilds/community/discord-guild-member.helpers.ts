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

/** True when the user may Join / Propose community hubs (A2). */
export function isInDiscordGuild(user: DiscordGuildMemberFields): boolean {
  return (
    user.discordId !== null &&
    user.guildMemberSeenAt !== null &&
    user.deactivatedAt === null
  );
}
