/**
 * ROK-1483 — every query the thread mirror makes against
 * `discord_thread_messages`. Drizzle only: no Discord client, no policy, no
 * DTO shaping. The service decides WHAT to write; this module knows only HOW.
 */
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  snowflakeToSortKey,
  type MirroredMessageRow,
  type MirroredMessageValues,
} from './thread-mirror.helpers';

/** Drizzle handle carrying the full schema. */
export type ThreadMirrorDb = PostgresJsDatabase<typeof schema>;

/** Paging options for {@link listMirroredMessages}. */
export interface ListMirroredOptions {
  /** Exclusive `messageId` cursor — return messages OLDER than this one. */
  before?: string;
  /** How many messages the caller wants; one extra row is always fetched. */
  limit: number;
}

/**
 * Write one live message, overwriting an edit in place.
 *
 * The update set deliberately omits `deleted_at` (D10): a re-delivered gateway
 * event or a later backfill must never RESURRECT a message its author removed.
 * That omission is what makes idempotency hold under delete — without it, the
 * `CONNECTED` reconcile would un-delete every deleted message on every deploy.
 *
 * @param db - Drizzle handle.
 * @param threadId - The thread the message belongs to.
 * @param values - Columns derived from the message by `toMirrorRow`.
 */
export async function upsertMirroredMessage(
  db: ThreadMirrorDb,
  threadId: string,
  values: MirroredMessageValues,
): Promise<void> {
  await db
    .insert(schema.discordThreadMessages)
    .values({ ...values, threadId, mirrorUpdatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.discordThreadMessages.messageId,
      set: {
        content: sql`excluded.content`,
        editedAt: sql`excluded.edited_at`,
        attachments: sql`excluded.attachments`,
        mentions: sql`excluded.mentions`,
        mirrorUpdatedAt: new Date(),
      },
    });
}

/**
 * Insert backfilled messages, skipping any already mirrored.
 *
 * `onConflictDoNothing` rather than the upsert above is what makes AC2 true:
 * a second backfill writes nothing at all, so no row's `mirror_updated_at`
 * moves and no soft delete is undone.
 *
 * @param db - Drizzle handle.
 * @param threadId - The thread being backfilled.
 * @param values - Rows to insert, oldest first. An empty list writes nothing.
 */
export async function insertMirroredMessages(
  db: ThreadMirrorDb,
  threadId: string,
  values: MirroredMessageValues[],
): Promise<void> {
  if (values.length === 0) return;
  await db
    .insert(schema.discordThreadMessages)
    .values(values.map((row) => ({ ...row, threadId })))
    .onConflictDoNothing({ target: schema.discordThreadMessages.messageId });
}

/**
 * Soft-delete a message by id alone (D10).
 *
 * Id alone because a `messageDelete` gateway event may carry nothing else —
 * the message is already gone, so it can never be fetched.
 *
 * @param db - Drizzle handle.
 * @param messageId - The deleted Discord message id.
 */
export async function softDeleteMirroredMessage(
  db: ThreadMirrorDb,
  messageId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(schema.discordThreadMessages)
    .set({ deletedAt: now, mirrorUpdatedAt: now })
    .where(
      and(
        eq(schema.discordThreadMessages.messageId, messageId),
        isNull(schema.discordThreadMessages.deletedAt),
      ),
    );
}

/**
 * One page of a thread's mirrored messages, NEWEST FIRST.
 *
 * Descending is not a style choice: the default page is the newest `limit`
 * messages and `before` pages BACKWARDS, so the rows have to be taken from the
 * top. The caller reverses for render order and uses the one extra row to
 * derive `hasMore` — this module returns rows, not pagination state.
 *
 * Soft-deleted rows are omitted entirely (D10): a delete is reflected as a
 * disappearance, never as a tombstone.
 *
 * @param db - Drizzle handle.
 * @param threadId - The thread to read.
 * @param options - `limit` plus an optional exclusive `before` cursor.
 * @returns Up to `limit + 1` rows, descending by `sort_key`.
 */
export function listMirroredMessages(
  db: ThreadMirrorDb,
  threadId: string,
  options: ListMirroredOptions,
): Promise<MirroredMessageRow[]> {
  const cursor =
    options.before === undefined
      ? undefined
      : lt(
          schema.discordThreadMessages.sortKey,
          snowflakeToSortKey(options.before),
        );
  return db
    .select()
    .from(schema.discordThreadMessages)
    .where(
      and(
        eq(schema.discordThreadMessages.threadId, threadId),
        isNull(schema.discordThreadMessages.deletedAt),
        cursor,
      ),
    )
    .orderBy(desc(schema.discordThreadMessages.sortKey))
    .limit(options.limit + 1);
}

/**
 * Whether a thread has EVER been mirrored — reconcile's "already done" check.
 *
 * Called by `ThreadMirrorService.reconcile` to bound the reconnect walk: a
 * thread with rows has been backfilled and is gateway-fed, so re-walking it is
 * Discord REST traffic that can only re-skip the same rows.
 *
 * Counts soft-deleted rows on purpose: a thread whose only message was later
 * deleted has still been backfilled, and re-walking it would be a Discord call
 * that can only re-skip the same row.
 *
 * @param db - Drizzle handle.
 * @param threadId - The thread to probe.
 * @returns True when at least one mirrored row exists.
 */
export async function hasAnyMirrored(
  db: ThreadMirrorDb,
  threadId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.discordThreadMessages.id })
    .from(schema.discordThreadMessages)
    .where(eq(schema.discordThreadMessages.threadId, threadId))
    .limit(1);
  return rows.length > 0;
}
