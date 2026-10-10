/**
 * ROK-1759: the column set `UsersService.linkDiscord` writes. Linking a
 * DIFFERENT Discord id clears `guild_member_seen_at` — the stamp described the
 * old account, and a non-member new id must not inherit sweep / 50278
 * candidacy (the DISCORD_LOGIN listener re-stamps a member). Re-linking the
 * same id (incl. its `unlinked:` form) keeps it. The CASE is evaluated in the
 * UPDATE against the row's pre-update id, so there is no read-then-write race.
 */
import { sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

export function linkDiscordFields(
  discordId: string,
  username: string,
  avatar: string | null,
) {
  const { discordId: current, guildMemberSeenAt: seen } = schema.users;
  return {
    discordId,
    username,
    avatar,
    guildMemberSeenAt: sql<Date | null>`CASE WHEN ${current} IN (${discordId}, ${`unlinked:${discordId}`}) THEN ${seen} ELSE NULL END`,
    updatedAt: new Date(),
  };
}
