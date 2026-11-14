/**
 * ROK-1175 L2 — `hub_forum_threads` / `hub_forum_replies` reads (no access
 * logic). Every read left-joins the author so the service maps with
 * `hub-forum.mappers`. Keyset paging runs on the raw indexed columns with the
 * DB's own µs-precision text in the cursor (the hub-posts pattern).
 */
import {
  and,
  count,
  eq,
  gt,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { HUB_FORUM_PAGE_MAX } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { HubForumCursor } from './hub-forum.helpers';
import type {
  HubForumReplyRecord,
  HubForumThreadRecord,
} from './hub-forum.mappers';

export type Db = PostgresJsDatabase<typeof schema>;

const { hubForumThreads: threads, hubForumReplies: replies, users } = schema;
const author = alias(users, 'hub_forum_author');
const authorColumns = {
  userId: author.id,
  username: author.username,
  displayName: author.displayName,
  avatar: author.avatar,
  customAvatarUrl: author.customAvatarUrl,
  discordId: author.discordId,
};

/** UTC ISO text with microseconds — the exact cursor value. */
function usText(col: AnyPgColumn): SQL<string> {
  return sql<string>`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Listed threads: live, or deleted with live replies (D6). */
export const listedThread = or(
  isNull(threads.deletedAt),
  gt(threads.replyCount, 0),
);

/** One page; `next` is null on the last page. */
export interface ForumPage<R> {
  records: R[];
  next: HubForumCursor | null;
}

/** Split a `limit + 1` probe into the page and the next cursor. */
export function splitPage<R>(
  rows: readonly { record: R; id: number; cursorAt: string }[],
  limit: number,
): ForumPage<R> {
  const kept = rows.slice(0, limit);
  const last = kept[kept.length - 1];
  const next =
    rows.length > limit && last ? { at: last.cursorAt, id: last.id } : null;
  return { records: kept.map((row) => row.record), next };
}

function selectThreads(db: Db, where: SQL | undefined) {
  return db
    .select({
      thread: threads,
      author: authorColumns,
      cursorAt: usText(threads.lastActivityAt),
    })
    .from(threads)
    .leftJoin(author, eq(author.id, threads.authorId))
    .where(where);
}

function selectReplies(db: Db, where: SQL | undefined) {
  return db
    .select({
      reply: replies,
      author: authorColumns,
      cursorAt: usText(replies.createdAt),
    })
    .from(replies)
    .leftJoin(author, eq(author.id, replies.authorId))
    .where(where);
}

/** Unpinned feed probe: latest activity first (exported for SQL tests). */
export function listThreadsQuery(
  db: Db,
  guildId: number,
  limit: number,
  cursor: HubForumCursor | null,
) {
  const after = cursor
    ? sql`(${threads.lastActivityAt}, ${threads.id}) < (${cursor.at}::timestamptz, ${cursor.id})`
    : undefined;
  const where = and(
    eq(threads.guildId, guildId),
    isNull(threads.pinnedAt),
    listedThread,
    after,
  );
  return selectThreads(db, where)
    .orderBy(
      sql`${threads.lastActivityAt} desc nulls last`,
      sql`${threads.id} desc nulls last`,
    )
    .limit(limit + 1);
}

/** Live pinned threads, newest pin first (exported for SQL tests). */
export function pinnedThreadsQuery(db: Db, guildId: number) {
  const where = and(
    eq(threads.guildId, guildId),
    isNotNull(threads.pinnedAt),
    isNull(threads.deletedAt),
  );
  return selectThreads(db, where)
    .orderBy(sql`${threads.pinnedAt} desc nulls last`, sql`${threads.id} desc`)
    .limit(HUB_FORUM_PAGE_MAX);
}

/** A list page; `pinned` is filled on the first page (no cursor) only. */
export async function listThreads(
  db: Db,
  guildId: number,
  limit: number,
  cursor: HubForumCursor | null,
): Promise<
  ForumPage<HubForumThreadRecord> & { pinned: HubForumThreadRecord[] }
> {
  const rows = await listThreadsQuery(db, guildId, limit, cursor);
  const page = splitPage(rows.map(threadProbe), limit);
  if (cursor) return { ...page, pinned: [] };
  const pinned = await pinnedThreadsQuery(db, guildId);
  return { ...page, pinned: pinned.map((row) => threadProbe(row).record) };
}

function threadProbe(row: HubForumThreadRecord & { cursorAt: string }) {
  const record = { thread: row.thread, author: row.author };
  return { record, id: row.thread.id, cursorAt: row.cursorAt };
}

/** One thread scoped to its hub (another hub's id → undefined). */
export async function findThread(
  db: Db,
  guildId: number,
  threadId: number,
): Promise<HubForumThreadRecord | undefined> {
  const where = and(eq(threads.guildId, guildId), eq(threads.id, threadId));
  const [row] = await selectThreads(db, where).limit(1);
  return row && threadProbe(row).record;
}

/** Widget rows: live threads only (the card never shows a placeholder). */
const liveThreadOf = (guildId: number) =>
  and(eq(threads.guildId, guildId), isNull(threads.deletedAt));

/** Widget probe: removed threads are excluded BEFORE the limit (SQL tests). */
export function latestThreadsQuery(db: Db, guildId: number, limit: number) {
  return selectThreads(db, liveThreadOf(guildId))
    .orderBy(
      sql`${threads.lastActivityAt} desc nulls last`,
      sql`${threads.id} desc nulls last`,
    )
    .limit(limit);
}

/** Widget: the `limit` newest-activity live threads + the live total. */
export async function latestThreads(
  db: Db,
  guildId: number,
  limit: number,
): Promise<{ records: HubForumThreadRecord[]; total: number }> {
  const rows = await latestThreadsQuery(db, guildId, limit);
  const [tally] = await db
    .select({ n: count() })
    .from(threads)
    .where(liveThreadOf(guildId));
  return {
    records: rows.map((r) => threadProbe(r).record),
    total: tally?.n ?? 0,
  };
}

/** Reply page probe: oldest first (exported for SQL tests). */
export function listRepliesQuery(
  db: Db,
  threadId: number,
  limit: number,
  cursor: HubForumCursor | null,
) {
  const after = cursor
    ? sql`(${replies.createdAt}, ${replies.id}) > (${cursor.at}::timestamptz, ${cursor.id})`
    : undefined;
  return selectReplies(db, and(eq(replies.threadId, threadId), after))
    .orderBy(replies.createdAt, replies.id)
    .limit(limit + 1);
}

function replyProbe(row: HubForumReplyRecord & { cursorAt: string }) {
  const record = { reply: row.reply, author: row.author };
  return { record, id: row.reply.id, cursorAt: row.cursorAt };
}

/** Oldest-first page of a thread's replies (deleted ones as placeholders). */
export async function listReplies(
  db: Db,
  threadId: number,
  limit: number,
  cursor: HubForumCursor | null,
): Promise<ForumPage<HubForumReplyRecord>> {
  const rows = await listRepliesQuery(db, threadId, limit, cursor);
  return splitPage(rows.map(replyProbe), limit);
}

/** One reply scoped to its hub and thread (else undefined). */
export async function findReply(
  db: Db,
  target: { guildId: number; threadId: number; replyId: number },
): Promise<HubForumReplyRecord | undefined> {
  const where = and(
    eq(replies.guildId, target.guildId),
    eq(replies.threadId, target.threadId),
    eq(replies.id, target.replyId),
  );
  const [row] = await selectReplies(db, where).limit(1);
  return row && replyProbe(row).record;
}
