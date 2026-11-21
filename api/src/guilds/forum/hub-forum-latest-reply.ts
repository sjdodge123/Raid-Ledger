/**
 * ROK-2229 — the Forum list row of an event thread previews its newest live
 * reply ("Mirelle: Count me in…"), as in the approved mockup. Signup lines
 * (ROK-2274) are skipped. One batched
 * `DISTINCT ON (thread_id)` query covers every event thread on the page —
 * never one query per row. Normal threads keep their root preview.
 */
import type {
  HubForumLatestReply,
  HubForumThreadSummary,
} from '@raid-ledger/contract';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { toPerson } from '../posts/hub-posts.helpers';
import { forumPreview } from './hub-forum.helpers';
import { forumSync } from './hub-forum.mappers';
import { author, authorColumns, type Db } from './hub-forum.queries';

const replies = schema.hubForumReplies;

/** Newest live reply per thread id, keyed by thread id (one query). */
export async function latestReplyPreviews(
  db: Db,
  threadIds: number[],
): Promise<Map<number, HubForumLatestReply>> {
  const out = new Map<number, HubForumLatestReply>();
  if (threadIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([replies.threadId], {
      threadId: replies.threadId,
      body: replies.body,
      authorDiscordId: replies.authorDiscordId,
      authorDiscordName: replies.authorDiscordName,
      authorDiscordAvatar: replies.authorDiscordAvatar,
      author: authorColumns,
    })
    .from(replies)
    .leftJoin(author, eq(author.id, replies.authorId))
    .where(
      and(
        inArray(replies.threadId, threadIds),
        isNull(replies.deletedAt),
        // ROK-2274 D8: a signup line is never the row's "latest reply".
        eq(replies.kind, 'reply'),
      ),
    )
    .orderBy(replies.threadId, desc(replies.createdAt), desc(replies.id));
  for (const row of rows) {
    const person = row.author ? toPerson(row.author) : null;
    // ROK-2208: a Discord guest reply carries its Discord name for the row.
    const { discordAuthor } = forumSync(row, row.author);
    out.set(row.threadId, {
      author: person,
      ...(discordAuthor ? { discordAuthor } : {}),
      preview: forumPreview(row.body),
    });
  }
  return out;
}

/** True for a live event thread (it carries an `event` or `lock` key). */
function isLiveEventThread(t: HubForumThreadSummary): boolean {
  return t.deleted === null && ('event' in t || 'lock' in t);
}

/**
 * Sets `latestReply` (null when it has none) on the live event threads of
 * each list, fetching every list's previews in a single query.
 */
export async function withLatestReplies(
  db: Db,
  lists: HubForumThreadSummary[][],
): Promise<HubForumThreadSummary[][]> {
  const ids = lists
    .flat()
    .filter(isLiveEventThread)
    .map((t) => t.id);
  const latest = await latestReplyPreviews(db, ids);
  return lists.map((list) =>
    list.map((t) =>
      isLiveEventThread(t)
        ? { ...t, latestReply: latest.get(t.id) ?? null }
        : t,
    ),
  );
}
