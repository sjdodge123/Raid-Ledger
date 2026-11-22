/**
 * ROK-2297 — the RL half of "copy earlier chat": one transaction, locked on
 * the target thread, that copies a source thread's live member replies into
 * the target under one `copy_header` row. Copies keep the original author
 * (RL user and/or Discord guest columns), body and timestamps, and point at
 * the ORIGINAL reply (`copied_from_reply_id`). Each source → target pair
 * copies at most once: a header already there ⇒ nothing; both partial unique
 * indexes back that with `ON CONFLICT DO NOTHING`.
 *
 * Writes emit nothing (no `HUB_FORUM_CHANGED`, no notification) — the caller
 * mirrors the returned ids to Discord itself, in order.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import {
  copyHeaderBody,
  copyHeaderTime,
  copyRoot,
  planChatCopy,
  sameHub,
  type ChatCopyPlan,
} from './forum-chat-copy.rules';

const threads = schema.hubForumThreads;
const replies = schema.hubForumReplies;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface ChatCopyInput {
  srcThreadId: number;
  dstThreadId: number;
  /** Bumps the target's `last_activity_at` (never backwards). */
  now?: Date;
}

/** What was written: the header first, then the copies oldest first. */
export interface ChatCopyResult {
  guildId: number;
  threadId: number;
  replyIds: number[];
}

/** The source-row columns a copy carries. */
const sourceColumns = {
  id: replies.id,
  kind: replies.kind,
  deletedAt: replies.deletedAt,
  copiedFromReplyId: replies.copiedFromReplyId,
  createdAt: replies.createdAt,
  editedAt: replies.editedAt,
  authorId: replies.authorId,
  authorDiscordId: replies.authorDiscordId,
  authorDiscordName: replies.authorDiscordName,
  authorDiscordAvatar: replies.authorDiscordAvatar,
  body: replies.body,
};
async function liveThread(tx: Tx, id: number) {
  const [row] = await tx
    .select({ id: threads.id, guildId: threads.guildId, title: threads.title })
    .from(threads)
    .where(and(eq(threads.id, id), isNull(threads.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function headerExists(tx: Tx, input: ChatCopyInput): Promise<boolean> {
  const [row] = await tx
    .select({ id: replies.id })
    .from(replies)
    .where(
      and(
        eq(replies.threadId, input.dstThreadId),
        eq(replies.kind, 'copy_header'),
        eq(replies.copiedFromThreadId, input.srcThreadId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The target's own reply ids plus the roots of its copies (any state). */
async function takenRoots(tx: Tx, dstThreadId: number): Promise<Set<number>> {
  const rows = await tx
    .select({ id: replies.id, root: replies.copiedFromReplyId })
    .from(replies)
    .where(eq(replies.threadId, dstThreadId));
  const taken = new Set<number>();
  for (const r of rows) {
    taken.add(r.id);
    if (r.root !== null) taken.add(r.root);
  }
  return taken;
}

async function sourceRows(tx: Tx, srcThreadId: number) {
  return tx
    .select(sourceColumns)
    .from(replies)
    .where(
      and(
        eq(replies.threadId, srcThreadId),
        eq(replies.kind, 'reply'),
        isNull(replies.deletedAt),
      ),
    );
}

type SourceRow = Awaited<ReturnType<typeof sourceRows>>[number];

interface Target {
  guildId: number;
  input: ChatCopyInput;
}

async function insertHeader(
  tx: Tx,
  t: Target,
  body: string,
  plan: ChatCopyPlan<SourceRow>,
): Promise<number | null> {
  const [row] = await tx
    .insert(replies)
    .values({
      threadId: t.input.dstThreadId,
      guildId: t.guildId,
      kind: 'copy_header',
      authorId: null,
      body,
      createdAt: copyHeaderTime(plan),
      copiedFromThreadId: t.input.srcThreadId,
    })
    .onConflictDoNothing()
    .returning({ id: replies.id });
  return row?.id ?? null;
}

/** A copy keeps the original's author, text and times; points at its root. */
function copyValues(t: Target, r: SourceRow) {
  return {
    threadId: t.input.dstThreadId,
    guildId: t.guildId,
    kind: 'reply' as const,
    authorId: r.authorId,
    authorDiscordId: r.authorDiscordId,
    authorDiscordName: r.authorDiscordName,
    authorDiscordAvatar: r.authorDiscordAvatar,
    body: r.body,
    createdAt: r.createdAt,
    editedAt: r.editedAt,
    copiedFromReplyId: copyRoot(r),
    copiedFromThreadId: t.input.srcThreadId,
  };
}

async function insertCopies(
  tx: Tx,
  t: Target,
  rows: readonly SourceRow[],
): Promise<number[]> {
  if (rows.length === 0) return [];
  const written = await tx
    .insert(replies)
    .values(rows.map((r) => copyValues(t, r)))
    .onConflictDoNothing()
    .returning({ id: replies.id, createdAt: replies.createdAt });
  written.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
  );
  return written.map((w) => w.id);
}

async function bumpThread(tx: Tx, threadId: number, n: number, now: Date) {
  await tx
    .update(threads)
    .set({
      replyCount: sql`${threads.replyCount} + ${n}`,
      lastActivityAt: sql`GREATEST(${threads.lastActivityAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(eq(threads.id, threadId));
}

async function copyInTx(
  tx: Tx,
  input: ChatCopyInput,
): Promise<ChatCopyResult | null> {
  const dst = await liveThread(tx, input.dstThreadId);
  const src = await liveThread(tx, input.srcThreadId);
  if (!dst || !src || !sameHub(src, dst)) return null;
  if (await headerExists(tx, input)) return null;
  const rows = await sourceRows(tx, input.srcThreadId);
  const plan = planChatCopy(rows, await takenRoots(tx, input.dstThreadId));
  const body = copyHeaderBody(src.title, plan);
  if (body === null) return null;
  const t: Target = { guildId: dst.guildId, input };
  const headerId = await insertHeader(tx, t, body, plan);
  if (headerId === null) return null;
  const copyIds = await insertCopies(tx, t, plan.picked);
  // The header is a system line (ROK-2274 D8): only the copies count.
  await bumpThread(tx, dst.id, copyIds.length, input.now ?? new Date());
  return {
    guildId: dst.guildId,
    threadId: dst.id,
    replyIds: [headerId, ...copyIds],
  };
}

/**
 * Copy `src`'s earlier chat into `dst` (both live threads of ONE hub). Null
 * when nothing was written: a thread is missing or deleted, the threads are
 * in different hubs, the pair was copied before, or no row qualifies (see
 * `planChatCopy`). Idempotent and race-safe.
 */
export async function copyForumChat(
  db: Db,
  input: ChatCopyInput,
): Promise<ChatCopyResult | null> {
  if (input.srcThreadId === input.dstThreadId) return null;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('forum-chat-copy'), ${input.dstThreadId}::int)`,
    );
    return copyInTx(tx, input);
  });
}
