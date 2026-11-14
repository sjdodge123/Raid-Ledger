/**
 * ROK-1175 L2 — forum writes (no access logic). Soft delete keeps the text;
 * edits and deletes only touch live rows, so a second delete is a no-op
 * (`undefined`). Reply insert/delete keep `reply_count` and
 * `last_activity_at` in step inside one transaction (D5).
 */
import { and, count, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { HubForumDeleted } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type {
  HubForumReplySelect,
  HubForumThreadSelect,
} from '../../drizzle/schema/hub-forum';
import type { Db } from './hub-forum.queries';

const { hubForumThreads: threads, hubForumReplies: replies } = schema;

/** A transaction handle from `db.transaction`. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Advisory-lock namespace for the per-hub pin cap (ROK-1175). */
const PIN_LOCK_NS = 1175;

/** A thread addressed through its hub. */
export interface ThreadTarget {
  guildId: number;
  threadId: number;
}

/** A reply addressed through its hub and thread. */
export interface ReplyTarget extends ThreadTarget {
  replyId: number;
}

/** Who removed a row and in which capacity. */
export interface ForumRemoval {
  by: number;
  as: Exclude<HubForumDeleted, null>;
  now: Date;
}

function liveThread(target: ThreadTarget) {
  return and(
    eq(threads.guildId, target.guildId),
    eq(threads.id, target.threadId),
    isNull(threads.deletedAt),
  );
}

function liveReply(target: ReplyTarget) {
  return and(
    eq(replies.guildId, target.guildId),
    eq(replies.threadId, target.threadId),
    eq(replies.id, target.replyId),
    isNull(replies.deletedAt),
  );
}

/** Insert a thread; `now` stamps created/updated/last activity alike. */
export async function insertThread(
  db: Db,
  values: {
    guildId: number;
    authorId: number;
    title: string;
    body: string;
    now: Date;
  },
): Promise<HubForumThreadSelect> {
  const { now, ...rest } = values;
  const [row] = await db
    .insert(threads)
    .values({ ...rest, createdAt: now, updatedAt: now, lastActivityAt: now })
    .returning();
  if (!row) throw new Error(`hub_forum_threads insert returned no row`);
  return row;
}

/** Edit a live thread's title and/or body; stamps `edited_at`. */
export async function updateThread(
  db: Db,
  target: ThreadTarget,
  edit: { title?: string; body?: string; now: Date },
): Promise<HubForumThreadSelect | undefined> {
  const [row] = await db
    .update(threads)
    .set({
      ...(edit.title !== undefined ? { title: edit.title } : {}),
      ...(edit.body !== undefined ? { body: edit.body } : {}),
      editedAt: edit.now,
      updatedAt: edit.now,
    })
    .where(liveThread(target))
    .returning();
  return row;
}

/** Soft-delete a live thread and unpin it. */
export async function softDeleteThread(
  db: Db,
  target: ThreadTarget,
  removal: ForumRemoval,
): Promise<HubForumThreadSelect | undefined> {
  const [row] = await db
    .update(threads)
    .set({
      deletedAt: removal.now,
      deletedBy: removal.by,
      deletedAs: removal.as,
      pinnedAt: null,
      pinnedBy: null,
      updatedAt: removal.now,
    })
    .where(liveThread(target))
    .returning();
  return row;
}

/**
 * Pin (`pin` set) or unpin (`null`) a live thread. Idempotent: re-pinning
 * keeps the original pin time and pinner.
 */
export async function setThreadPin(
  db: Db | Tx,
  target: ThreadTarget,
  pin: { by: number; now: Date } | null,
): Promise<HubForumThreadSelect | undefined> {
  const set = pin
    ? {
        pinnedAt: sql`coalesce(${threads.pinnedAt}, ${pin.now.toISOString()}::timestamptz)`,
        pinnedBy: sql`case when ${threads.pinnedAt} is null then ${pin.by} else ${threads.pinnedBy} end`,
      }
    : { pinnedAt: null, pinnedBy: null };
  const [row] = await db
    .update(threads)
    .set(set)
    .where(liveThread(target))
    .returning();
  return row;
}

/**
 * Pin a live thread unless the hub already has `cap` OTHER live pinned
 * threads (`'full'` → the service's 409), so the list's capped pinned group
 * can never hide one. A per-hub advisory lock serialises concurrent pins.
 */
export async function pinThread(
  db: Db,
  target: ThreadTarget,
  pin: { by: number; now: Date },
  cap: number,
): Promise<HubForumThreadSelect | undefined | 'full'> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${PIN_LOCK_NS}::int, ${target.guildId}::int)`,
    );
    const [tally] = await tx
      .select({ n: count() })
      .from(threads)
      .where(
        and(
          eq(threads.guildId, target.guildId),
          isNotNull(threads.pinnedAt),
          isNull(threads.deletedAt),
          ne(threads.id, target.threadId),
        ),
      );
    if ((tally?.n ?? 0) >= cap) return 'full';
    return setThreadPin(tx, target, pin);
  });
}

/**
 * Add a reply and bump the thread's counter + last activity in one
 * transaction; `undefined` (nothing written) when the thread is gone or
 * deleted — the service's 409 (Q8).
 */
export async function insertReply(
  db: Db,
  target: ThreadTarget,
  values: { authorId: number; body: string; now: Date },
): Promise<HubForumReplySelect | undefined> {
  return db.transaction(async (tx) => {
    const bumped = await tx
      .update(threads)
      .set({
        replyCount: sql`${threads.replyCount} + 1`,
        lastActivityAt: values.now,
      })
      .where(liveThread(target))
      .returning({ id: threads.id });
    if (bumped.length === 0) return undefined;
    const { now, ...rest } = values;
    const [row] = await tx
      .insert(replies)
      .values({
        ...rest,
        threadId: target.threadId,
        guildId: target.guildId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row;
  });
}

/** Replace a live reply's body; stamps `edited_at`. */
export async function updateReply(
  db: Db,
  target: ReplyTarget,
  edit: { body: string; now: Date },
): Promise<HubForumReplySelect | undefined> {
  const [row] = await db
    .update(replies)
    .set({ body: edit.body, editedAt: edit.now, updatedAt: edit.now })
    .where(liveReply(target))
    .returning();
  return row;
}

/**
 * Soft-delete a live reply and drop the thread's live-reply count (never
 * below 0). `last_activity_at` does not move (D5).
 */
export async function softDeleteReply(
  db: Db,
  target: ReplyTarget,
  removal: ForumRemoval,
): Promise<HubForumReplySelect | undefined> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(replies)
      .set({
        deletedAt: removal.now,
        deletedBy: removal.by,
        deletedAs: removal.as,
        updatedAt: removal.now,
      })
      .where(liveReply(target))
      .returning();
    if (!row) return undefined;
    await tx
      .update(threads)
      .set({ replyCount: sql`greatest(${threads.replyCount} - 1, 0)` })
      .where(eq(threads.id, target.threadId));
    return row;
  });
}
