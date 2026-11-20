/**
 * ROK-2226 §5.2 — `syncEventDiscussion`, the one idempotent reconciler behind
 * every lifecycle listener and the lazy `GET events/:id/discussion`. It
 * compares the event row to its live thread and converges: insert, refresh
 * (title/root/deadline, never `edited_at`), detach, or detach-and-reinsert on
 * a retag. It never touches replies, `reply_count`, pins or soft-delete state.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import {
  type DbOrTx,
  findEventForSync,
  findLiveEventThread,
  type EventSyncRow,
  type LiveEventThread,
} from './event-discussion.queries';

/** Writes stay open until the scheduled end + 1 h (ROK-2272: 1 h (was 24 h)). */
export const WRITE_GRACE_MS = 1 * 3_600_000;
const TITLE_MAX = 120;

export type SyncAction = 'noop' | 'insert' | 'refresh' | 'detach' | 'move';

/** §5.2 decision table, pure. `event` null = the event row is gone. */
export function planSync(
  event: EventSyncRow | null,
  thread: Pick<LiveEventThread, 'guildId'> | null,
): SyncAction {
  const eligible = event !== null && event.guildId !== null && !event.isAdHoc;
  if (!eligible) return thread ? 'detach' : 'noop';
  if (!thread) return 'insert';
  return thread.guildId === event.guildId ? 'refresh' : 'move';
}

/** Event title → thread title: trimmed, ≤120 code points, never empty (D5). */
export function eventThreadTitle(title: string): string {
  const cut = Array.from(title.trim()).slice(0, TITLE_MAX).join('').trim();
  return cut.length > 0 ? cut : 'Event';
}

/** The generated, system-owned root post (D6). */
export function eventThreadRootBody(title: string, eventId: number): string {
  const safe = eventThreadTitle(title).replace(/[\\*_`[\]<>~|#]/g, '\\$&');
  return `Discussion for **${safe}**. [Open the event](/events/${eventId})`;
}

export function writeClosesAtFor(end: Date): Date {
  return new Date(end.getTime() + WRITE_GRACE_MS);
}

/** The fields the event dictates on its thread. */
function derived(event: EventSyncRow) {
  return {
    title: eventThreadTitle(event.title),
    body: eventThreadRootBody(event.title, event.id),
    writeClosesAt: writeClosesAtFor(event.end),
  };
}

async function insertEventThread(
  tx: DbOrTx,
  event: EventSyncRow,
  now: Date,
): Promise<void> {
  if (event.guildId === null) return;
  await tx
    .insert(schema.hubForumThreads)
    .values({
      guildId: event.guildId,
      authorId: event.creatorId,
      eventId: event.id,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      ...derived(event),
    })
    .onConflictDoNothing();
}

/** System refresh of an attached thread — never stamps `edited_at`. */
export async function syncThreadFromEvent(
  tx: DbOrTx,
  thread: LiveEventThread,
  event: EventSyncRow,
  now: Date,
): Promise<void> {
  const next = derived(event);
  const same =
    thread.title === next.title &&
    thread.body === next.body &&
    thread.writeClosesAt?.getTime() === next.writeClosesAt.getTime();
  if (same) return;
  await tx
    .update(schema.hubForumThreads)
    .set({ ...next, updatedAt: now })
    .where(eq(schema.hubForumThreads.id, thread.id));
}

/** Detach the event's live thread (untag, retag, delete) — read-only, stays put. */
export async function detachEventThreads(
  db: DbOrTx,
  eventId: number,
  now: Date = new Date(),
): Promise<void> {
  const t = schema.hubForumThreads;
  await db
    .update(t)
    .set({ eventDetachedAt: now, updatedAt: now })
    .where(and(eq(t.eventId, eventId), isNull(t.eventDetachedAt)));
}

async function apply(
  tx: DbOrTx,
  eventId: number,
  action: SyncAction,
  rows: { event: EventSyncRow | null; thread: LiveEventThread | null },
  now: Date,
): Promise<void> {
  const { event, thread } = rows;
  if (action === 'detach' || action === 'move') {
    await detachEventThreads(tx, eventId, now);
  }
  if (!event) return;
  if (action === 'insert' || action === 'move') {
    await insertEventThread(tx, event, now);
  } else if (action === 'refresh' && thread) {
    await syncThreadFromEvent(tx, thread, event, now);
  }
}

/** Reconcile one event's discussion thread. Idempotent; safe to race (AC9). */
export async function syncEventDiscussion(
  db: Db,
  eventId: number,
  now: Date = new Date(),
): Promise<SyncAction> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('event-discussion'), ${eventId}::int)`,
    );
    const event = await findEventForSync(tx, eventId);
    const thread = await findLiveEventThread(tx, eventId);
    const action = planSync(event, thread);
    await apply(tx, eventId, action, { event, thread }, now);
    return action;
  });
}
