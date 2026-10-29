/**
 * ROK-1968 §5.3 — `hub_session_notes` / `hub_session_note_items` reads and
 * writes (no access logic). `updated_at` is the D8 concurrency token, so it is
 * read as the DB's own microsecond UTC text — a JS `Date` would round it.
 */
import { and, asc, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { HubSessionNoteItemSelect } from '../../drizzle/schema/hub-session-notes';
import type { HubPostPersonRow } from '../posts/hub-posts.helpers';
import type {
  ItemRewritePlan,
  PinnedEventRow,
} from './hub-session-note.helpers';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

const {
  hubSessionNotes: notes,
  hubSessionNoteItems: items,
  events,
  users,
} = schema;

const updatedAtText = sql<string>`to_char(${notes.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The stored note with its last editor (null once wiped). */
export interface NoteRecord {
  guildId: number;
  body: string;
  updatedAt: string;
  clearAfterEventId: number | null;
  clearAfterArmed: boolean;
  editor: HubPostPersonRow | null;
}

/** The note row, or null when the hub has none. */
export async function findNote(
  db: Db,
  guildId: number,
): Promise<NoteRecord | null> {
  const [row] = await db
    .select({
      guildId: notes.guildId,
      body: notes.body,
      updatedAt: updatedAtText,
      clearAfterEventId: notes.clearAfterEventId,
      clearAfterArmed: notes.clearAfterArmed,
      editor: {
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        avatar: users.avatar,
        customAvatarUrl: users.customAvatarUrl,
        discordId: users.discordId,
      },
    })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.updatedBy))
    .where(eq(notes.guildId, guildId));
  return row ?? null;
}

/** D8: lock the note row for an editor save; null when absent. */
export async function lockNote(
  tx: DbOrTx,
  guildId: number,
): Promise<{ updatedAt: string; clearAfterEventId: number | null } | null> {
  const [row] = await tx
    .select({
      updatedAt: updatedAtText,
      clearAfterEventId: notes.clearAfterEventId,
    })
    .from(notes)
    .where(eq(notes.guildId, guildId))
    .for('update');
  return row ?? null;
}

const pinColumns = {
  id: events.id,
  title: events.title,
  duration: events.duration,
  cancelledAt: events.cancelledAt,
};

/** The pinned event (null when unpinned or the event is gone). */
export async function findPinnedEvent(
  db: DbOrTx,
  eventId: number | null,
): Promise<PinnedEventRow | null> {
  if (eventId === null) return null;
  const [row] = await db
    .select(pinColumns)
    .from(events)
    .where(eq(events.id, eventId));
  return row ?? null;
}

/**
 * D5 — the hub's next tagged event, mirroring `hubEvents` in
 * `community-events.queries.ts` (module-private there): not cancelled, not
 * mid-reschedule, not yet ended. A running event counts (ruling 4c).
 */
export async function findNextHubEvent(
  db: DbOrTx,
  guildId: number,
  now: Date,
): Promise<PinnedEventRow | null> {
  const [row] = await db
    .select(pinColumns)
    .from(events)
    .where(
      and(
        eq(events.guildId, guildId),
        isNull(events.cancelledAt),
        isNull(events.reschedulingPollId),
        sql`upper(${events.duration}) > ${now.toISOString()}::timestamp`,
      ),
    )
    .orderBy(asc(sql`lower(${events.duration})`))
    .limit(1);
  return row ?? null;
}

/** The checklist in display order. */
export function findItems(
  db: Db,
  guildId: number,
): Promise<HubSessionNoteItemSelect[]> {
  return db
    .select()
    .from(items)
    .where(eq(items.guildId, guildId))
    .orderBy(asc(items.position), asc(items.id));
}

/**
 * D6: delete only while still pinned to `eventId` (a re-pin survives) AND that
 * event is still uncancelled and ended — re-checked in the same statement, so
 * an event cancelled or rescheduled after the caller read it deletes nothing.
 */
export async function deleteExpiredNote(
  db: DbOrTx,
  guildId: number,
  eventId: number,
  now: Date,
): Promise<void> {
  const stillEnded = db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        isNull(events.cancelledAt),
        sql`upper(${events.duration}) <= ${now.toISOString()}::timestamp`,
      ),
    );
  await db
    .delete(notes)
    .where(
      and(
        eq(notes.guildId, guildId),
        eq(notes.clearAfterEventId, eventId),
        exists(stillEnded),
      ),
    );
}

/**
 * D5b: pin an armed note to `eventId`, only while it is still armed and
 * unpinned (a concurrent save or pin wins). Leaves `updated_at` alone so the
 * pin never causes an editor's 409.
 */
export async function pinArmedNote(
  db: DbOrTx,
  guildId: number,
  eventId: number,
): Promise<void> {
  await db
    .update(notes)
    .set({ clearAfterEventId: eventId, clearAfterArmed: false })
    .where(
      and(
        eq(notes.guildId, guildId),
        eq(notes.clearAfterArmed, true),
        isNull(notes.clearAfterEventId),
      ),
    );
}

/** Clear: the note and (cascade) its items. Idempotent. */
export async function deleteNote(db: Db, guildId: number): Promise<void> {
  await db.delete(notes).where(eq(notes.guildId, guildId));
}

/** The values an editor save writes to the note row. */
export interface NoteWrite {
  guildId: number;
  body: string;
  actorId: number;
  clearAfterEventId: number | null;
  clearAfterArmed: boolean;
}

/** Create path: false when a concurrent create won the row (D8 → 409). */
export async function insertNote(
  tx: DbOrTx,
  write: NoteWrite,
): Promise<boolean> {
  const rows = await tx
    .insert(notes)
    .values({
      guildId: write.guildId,
      body: write.body,
      updatedBy: write.actorId,
      clearAfterEventId: write.clearAfterEventId,
      clearAfterArmed: write.clearAfterArmed,
    })
    .onConflictDoNothing({ target: notes.guildId })
    .returning({ guildId: notes.guildId });
  return rows.length > 0;
}

/** Update path (row already locked by `lockNote`). */
export async function updateNote(tx: DbOrTx, write: NoteWrite): Promise<void> {
  await tx
    .update(notes)
    .set({
      body: write.body,
      updatedBy: write.actorId,
      updatedAt: sql`now()`,
      clearAfterEventId: write.clearAfterEventId,
      clearAfterArmed: write.clearAfterArmed,
    })
    .where(eq(notes.guildId, write.guildId));
}

/** The ids of the hub's stored checklist rows. */
export async function findItemIds(
  tx: DbOrTx,
  guildId: number,
): Promise<number[]> {
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(eq(items.guildId, guildId));
  return rows.map((r) => r.id);
}

/** Apply a `planItemRewrite` result (kept rows keep `done`). */
export async function rewriteItems(
  tx: DbOrTx,
  guildId: number,
  plan: ItemRewritePlan,
): Promise<void> {
  if (plan.deleteIds.length > 0) {
    await tx.delete(items).where(inArray(items.id, plan.deleteIds));
  }
  for (const row of plan.keep) {
    await tx
      .update(items)
      .set({ text: row.text, position: row.position })
      .where(and(eq(items.id, row.id), eq(items.guildId, guildId)));
  }
  if (plan.insert.length > 0) {
    await tx
      .insert(items)
      .values(plan.insert.map((row) => ({ guildId, ...row })));
  }
}

/** D4 tick/untick; false when the item is not this hub's. */
export async function tickItem(
  db: Db,
  guildId: number,
  itemId: number,
  done: boolean,
  actorId: number,
): Promise<boolean> {
  const rows = await db
    .update(items)
    .set(
      done
        ? { done: true, doneBy: actorId, doneAt: sql`now()` }
        : { done: false, doneBy: null, doneAt: null },
    )
    .where(and(eq(items.id, itemId), eq(items.guildId, guildId)))
    .returning({ id: items.id });
  return rows.length > 0;
}
