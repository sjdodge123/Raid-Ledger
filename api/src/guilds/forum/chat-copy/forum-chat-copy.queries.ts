/**
 * ROK-2297 review MAJOR-2 — the copy a pair already has, so a retried job
 * (the worker died after the copy committed, before every row was mirrored)
 * can re-drive step C. Re-sending is safe: the outbound link claim inserts
 * `ON CONFLICT DO NOTHING`, so an already-linked row sends nothing again.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import type { ChatCopyInput, ChatCopyResult } from './forum-chat-copy.writes';

const replies = schema.hubForumReplies;

/**
 * The live rows `src` copied into `dst` — header first, then the copies in
 * copy order (`created_at`, id) — or null when the pair has no copy.
 */
export async function findChatCopy(
  db: Db,
  pair: Pick<ChatCopyInput, 'srcThreadId' | 'dstThreadId'>,
): Promise<ChatCopyResult | null> {
  const rows = await db
    .select({ id: replies.id, guildId: replies.guildId })
    .from(replies)
    .where(
      and(
        eq(replies.threadId, pair.dstThreadId),
        eq(replies.copiedFromThreadId, pair.srcThreadId),
        isNull(replies.deletedAt),
      ),
    )
    .orderBy(
      desc(sql`${replies.kind} = 'copy_header'`),
      asc(replies.createdAt),
      asc(replies.id),
    );
  const [first] = rows;
  if (!first) return null;
  return {
    guildId: first.guildId,
    threadId: pair.dstThreadId,
    replyIds: rows.map((r) => r.id),
  };
}
