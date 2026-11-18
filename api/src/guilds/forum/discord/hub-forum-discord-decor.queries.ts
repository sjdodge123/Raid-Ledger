import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const forums = schema.hubForumDiscordForums;
const bindings = schema.hubForumDiscordBindings;

/** ROK-2258 ruling 4 — every forum at least one hub is bound to. */
export async function listBoundForums(
  db: ForumDiscordDb,
): Promise<{ id: number; channelId: string; discordGuildId: string }[]> {
  return db
    .selectDistinct({
      id: forums.id,
      channelId: forums.channelId,
      discordGuildId: forums.discordGuildId,
    })
    .from(forums)
    .innerJoin(bindings, eq(bindings.forumId, forums.id));
}

/** Discord post ids of the hubs' synced event threads (Event tag). */
export async function linkedEventThreadIds(
  db: ForumDiscordDb,
  guildIds: readonly number[],
): Promise<string[]> {
  if (guildIds.length === 0) return [];
  const l = schema.hubForumDiscordLinks;
  const t = schema.hubForumThreads;
  const rows = await db
    .select({ id: l.discordThreadId })
    .from(l)
    .innerJoin(t, eq(t.id, l.threadId))
    .where(
      and(
        eq(l.kind, 'thread'),
        inArray(l.guildId, [...guildIds]),
        isNotNull(t.eventId),
      ),
    );
  return rows.map((r) => r.id);
}
