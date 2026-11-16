/**
 * ROK-2226 — event discussion reads: the event row the reconciler needs, the
 * event's live thread, and whether a user is signed up to the event.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { HubForumReplyRecord } from '../hub-forum.mappers';
import { selectReplies, type Db } from '../hub-forum.queries';

/** A db handle or a transaction from `db.transaction`. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** What the reconciler reads from `events`. `end` = scheduled end (`upper(duration)`). */
export interface EventSyncRow {
  id: number;
  title: string;
  creatorId: number;
  guildId: number | null;
  isAdHoc: boolean;
  end: Date;
}

/** The event's live thread (`event_detached_at IS NULL`) — at most one (unique index). */
export interface LiveEventThread {
  id: number;
  guildId: number;
  title: string;
  body: string;
  writeClosesAt: Date | null;
}

/**
 * Signup statuses that may write in an event thread (ruling 2: tentative
 * writes; benched rows keep `signed_up`). Declined/roached-out/departed don't.
 */
export const WRITABLE_SIGNUP_STATUSES = ['signed_up', 'tentative'] as const;

/** The event row, or null when it was deleted. Accepts a transaction. */
export async function findEventForSync(
  db: DbOrTx,
  eventId: number,
): Promise<EventSyncRow | null> {
  const [row] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      creatorId: schema.events.creatorId,
      guildId: schema.events.guildId,
      isAdHoc: schema.events.isAdHoc,
      duration: schema.events.duration,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!row) return null;
  const { duration, ...rest } = row;
  return { ...rest, end: duration[1] };
}

/** The event's live (attached) thread, or null. */
export async function findLiveEventThread(
  db: DbOrTx,
  eventId: number,
): Promise<LiveEventThread | null> {
  const t = schema.hubForumThreads;
  const [row] = await db
    .select({
      id: t.id,
      guildId: t.guildId,
      title: t.title,
      body: t.body,
      writeClosesAt: t.writeClosesAt,
    })
    .from(t)
    .where(and(eq(t.eventId, eventId), isNull(t.eventDetachedAt)))
    .limit(1);
  return row ?? null;
}

/** True when `userId` holds a writable signup on the event (§6, ruling 2). */
export async function isEventSignup(
  db: Db,
  eventId: number,
  userId: number,
): Promise<boolean> {
  const s = schema.eventSignups;
  const [row] = await db
    .select({ id: s.id })
    .from(s)
    .where(
      and(
        eq(s.eventId, eventId),
        eq(s.userId, userId),
        inArray(s.status, [...WRITABLE_SIGNUP_STATUSES]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The `limit` newest live replies of a thread, oldest first (the event card). */
export async function newestLiveReplies(
  db: Db,
  threadId: number,
  limit: number,
): Promise<HubForumReplyRecord[]> {
  const r = schema.hubForumReplies;
  const rows = await selectReplies(
    db,
    and(eq(r.threadId, threadId), isNull(r.deletedAt)),
  )
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(limit);
  return rows
    .map((row) => ({ reply: row.reply, author: row.author }))
    .reverse();
}
