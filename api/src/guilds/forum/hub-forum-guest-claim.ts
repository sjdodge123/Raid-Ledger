/**
 * ROK-2208 — claim-on-link. A Discord user who posted in a synced Discord
 * forum before having an RL account shows as a guest ("via Discord"). When
 * that Discord account is linked (login, link or relink), every guest thread
 * and reply carrying its Discord id gets `author_id`. The Discord columns are
 * kept: they record where the row came from. Rows with an author are never
 * touched, so a claim cannot steal another user's post.
 */
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { Db } from './hub-forum.queries';

export interface HubForumGuestClaim {
  threads: number;
  replies: number;
}

export async function claimHubForumGuestRows(
  db: Db,
  discordId: string,
  userId: number,
): Promise<HubForumGuestClaim> {
  const { hubForumThreads: t, hubForumReplies: r } = schema;
  return db.transaction(async (tx) => {
    const threads = await tx
      .update(t)
      .set({ authorId: userId })
      .where(and(eq(t.authorDiscordId, discordId), isNull(t.authorId)))
      .returning({ id: t.id });
    const replies = await tx
      .update(r)
      .set({ authorId: userId })
      .where(and(eq(r.authorDiscordId, discordId), isNull(r.authorId)))
      .returning({ id: r.id });
    return { threads: threads.length, replies: replies.length };
  });
}
