/**
 * ROK-1446 D7 — Drizzle accessors for `discord_channel_presence_messages`.
 *
 * Thin by contract: every decision (when a room is empty, when the grace has
 * elapsed, whether a message still exists) belongs to
 * `ChannelPresenceEmbedService`. What lives here is only the persistence, so
 * the service can be read as the lifecycle and this file as the ledger.
 *
 * Two invariants are structural rather than procedural, and both are the
 * reason this file is not just `db.insert(...)` inline:
 *
 * - **One open row per room.** The table carries a partial unique index on
 *   `(guild_id, voice_channel_id) WHERE status = 'open'`. `openRow` aims an
 *   `ON CONFLICT ... DO NOTHING` at exactly that index — target columns *and*
 *   the predicate, because Postgres will not match a partial index without it
 *   — so a writer that loses the race performs a no-op and then adopts the
 *   winner's row. It never sees a 23505.
 * - **A violation must be prevented, never caught.** Under postgres.js a
 *   failed statement poisons the entire transaction, savepoints included (see
 *   memory `reference_postgres_savepoint_does_not_contain_violations`), so
 *   there is deliberately no try/catch here: an error from the driver
 *   propagates to the caller untouched.
 *
 * Closed rows are history. Writes that only make sense on a live message
 * (`closeRow`, `savePayloadHash`) carry `status = 'open'` in their predicate
 * so a reaper and a flush racing each other cannot resurrect a closed row.
 */
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

const table = schema.discordChannelPresenceMessages;

type Db = PostgresJsDatabase<typeof schema>;

/** A persisted presence-message row, exactly as stored. */
export type PresenceRow = typeof table.$inferSelect;

/** `status` values — mirrors the table's CHECK constraint. */
export const PRESENCE_OPEN = 'open';
export const PRESENCE_CLOSED = 'closed';

/**
 * Why a row stopped being the live message for its room:
 * `empty` — the room emptied and the binding's grace elapsed (D8);
 * `missing` — Discord no longer has the message (10008 on adoption, D7);
 * `unbound` — the binding or the voice channel no longer resolves;
 * `stale` — the cron reaper found it abandoned.
 */
export type PresenceCloseReason = 'empty' | 'missing' | 'unbound' | 'stale';

/** Identity of a newly opened presence message. */
export interface OpenRowInput {
  guildId: string;
  voiceChannelId: string;
  /** Null once the binding is deleted — the row still needs recap + close. */
  bindingId: string | null;
  textChannelId: string;
  messageId: string;
}

/** Outcome of `openRow`: `created` is false when an open row already existed. */
export interface OpenRowResult {
  row: PresenceRow;
  created: boolean;
}

/** Predicate for "the live row of this room". */
function openRoomPredicate(guildId: string, voiceChannelId: string): SQL {
  return and(
    eq(table.guildId, guildId),
    eq(table.voiceChannelId, voiceChannelId),
    eq(table.status, PRESENCE_OPEN),
  ) as SQL;
}

/**
 * The open presence row for a room, or `null` if it has none.
 *
 * The DB is truth for "does a message already exist here" — `ensureMessage`
 * consults this before it ever posts, which is what stops a bot restart from
 * producing a second message. The returned row carries `payloadHash`, the D5
 * dirty-check the flush compares against before issuing an edit.
 */
export async function findOpenRow(
  db: Db,
  guildId: string,
  voiceChannelId: string,
): Promise<PresenceRow | null> {
  const rows = await db
    .select()
    .from(table)
    .where(openRoomPredicate(guildId, voiceChannelId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Open the ledger row for a freshly posted presence message, idempotently.
 *
 * If another writer already holds the room's open row the insert is a no-op
 * (the partial unique index is the arbiter) and the existing row comes back
 * with `created: false` — the caller then knows the message it just posted is
 * a duplicate. Errors are NOT caught: see this file's header.
 */
export async function openRow(
  db: Db,
  input: OpenRowInput,
): Promise<OpenRowResult> {
  const [inserted] = await db
    .insert(table)
    .values({ ...input, status: PRESENCE_OPEN })
    .onConflictDoNothing({
      target: [table.guildId, table.voiceChannelId],
      // `where` here is the CONFLICT TARGET predicate — drizzle emits
      // `on conflict (cols) where <where> do nothing`, which is what makes
      // Postgres infer the PARTIAL index. It is a literal, not
      // `eq(table.status, PRESENCE_OPEN)`: that renders as `status = $1`, and
      // the planner cannot prove a parameter implies the index predicate, so
      // inference fails outright ("no unique or exclusion constraint matching
      // the ON CONFLICT specification"). It must match the index's own SQL
      // verbatim — the spec asserts the two render identically.
      where: sql`${table.status} = 'open'`,
    })
    .returning();
  if (inserted) return { row: inserted, created: true };

  const existing = await findOpenRow(db, input.guildId, input.voiceChannelId);
  if (!existing) {
    throw new Error(
      `no open presence row for ${input.voiceChannelId} after a conflicting insert`,
    );
  }
  return { row: existing, created: false };
}

/**
 * Stamp the first flush that saw an empty room (D8).
 *
 * Guarded on `empty_since IS NULL` so a room that stays empty keeps its
 * ORIGINAL timestamp — re-stamping it every tick would push the grace window
 * forward forever and the row would never close.
 */
export async function markEmpty(
  db: Db,
  id: string,
  emptySince: Date,
): Promise<void> {
  await db
    .update(table)
    .set({ emptySince, updatedAt: new Date() })
    .where(and(eq(table.id, id), isNull(table.emptySince)));
}

/** Clear the empty stamp when someone rejoins inside the grace window (D8). */
export async function clearEmpty(db: Db, id: string): Promise<void> {
  await db
    .update(table)
    .set({ emptySince: null, updatedAt: new Date() })
    .where(eq(table.id, id));
}

/**
 * Retire a row. Rows are closed, never deleted — the next occupancy opens a
 * new row and posts a new message, and the old one stays as history.
 */
export async function closeRow(
  db: Db,
  id: string,
  reason: PresenceCloseReason,
): Promise<void> {
  await db
    .update(table)
    .set({
      status: PRESENCE_CLOSED,
      closeReason: reason,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(table.id, id), eq(table.status, PRESENCE_OPEN)));
}

/**
 * Store the hash of the payload that was last SUCCESSFULLY rendered (D5).
 *
 * The flush writes this only after the edit resolves, so a failed edit leaves
 * the old hash in place and the next tick retries instead of concluding
 * "nothing changed".
 */
export async function savePayloadHash(
  db: Db,
  id: string,
  payloadHash: string,
): Promise<void> {
  await db
    .update(table)
    .set({ payloadHash, updatedAt: new Date() })
    .where(and(eq(table.id, id), eq(table.status, PRESENCE_OPEN)));
}

/**
 * Every open row across all rooms, oldest first — the input to `recover()`
 * after a bot reconnect (AC8).
 */
export async function listOpenRows(db: Db): Promise<PresenceRow[]> {
  return db
    .select()
    .from(table)
    .where(eq(table.status, PRESENCE_OPEN))
    .orderBy(asc(table.openedAt));
}
