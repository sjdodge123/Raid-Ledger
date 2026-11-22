/**
 * ROK-2297 review MAJOR-2 — the copy a pair already has, so a retried job
 * (the worker died after the copy committed, before every row was mirrored)
 * can re-drive step C. Re-sending is safe: the outbound link claim inserts
 * `ON CONFLICT DO NOTHING`, so an already-linked row sends nothing again.
 * Like the copy itself, it never answers for threads of two hubs (Codex P1).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import { sameHub } from './forum-chat-copy.rules';
import type { ChatCopyInput, ChatCopyResult } from './forum-chat-copy.writes';

const replies = schema.hubForumReplies;
const threads = schema.hubForumThreads;

type Pair = Pick<ChatCopyInput, 'srcThreadId' | 'dstThreadId'>;

/** Both threads exist and belong to the same hub. */
async function pairInOneHub(db: Db, pair: Pair): Promise<boolean> {
  const rows = await db
    .select({ id: threads.id, guildId: threads.guildId })
    .from(threads)
    .where(inArray(threads.id, [pair.srcThreadId, pair.dstThreadId]));
  const src = rows.find((r) => r.id === pair.srcThreadId);
  const dst = rows.find((r) => r.id === pair.dstThreadId);
  return src !== undefined && dst !== undefined && sameHub(src, dst);
}

/**
 * The live rows `src` copied into `dst` — header first, then the copies in
 * copy order (`created_at`, id) — or null when the pair has no copy or its
 * threads are in different hubs.
 */
export async function findChatCopy(
  db: Db,
  pair: Pair,
): Promise<ChatCopyResult | null> {
  if (!(await pairInOneHub(db, pair))) return null;
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
