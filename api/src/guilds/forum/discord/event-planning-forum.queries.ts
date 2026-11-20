/**
 * ROK-2272 §3.2 — reads behind the event-planning forum resolver. A
 * "bound forum" is a `hub_forum_discord_forums` row with ≥1 hub binding.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** A bound forum of one Discord guild (a resolver candidate). */
export interface BoundForum {
  /** `hub_forum_discord_forums.id`. */
  forumId: number;
  channelId: string;
  /** The bot created the channel. */
  managed: boolean;
  webhookId: string | null;
}

/**
 * The Discord guild's forums that at least one hub binds, oldest first.
 *
 * @param db - Drizzle handle.
 * @param discordGuildId - The Discord guild (server) snowflake.
 */
export async function loadBoundForums(
  db: ForumDiscordDb,
  discordGuildId: string,
): Promise<BoundForum[]> {
  const f = schema.hubForumDiscordForums;
  const b = schema.hubForumDiscordBindings;
  const bound = db.select({ forumId: b.forumId }).from(b);
  return db
    .select({
      forumId: f.id,
      channelId: f.channelId,
      managed: f.managed,
      webhookId: f.webhookId,
    })
    .from(f)
    .where(and(eq(f.discordGuildId, discordGuildId), inArray(f.id, bound)))
    .orderBy(asc(f.id));
}
