/**
 * ROK-1499 — Drizzle accessors for `discord_channel_presence_occupancy`.
 *
 * The presence flush re-derives the room from Discord every tick and keeps
 * nothing (D4), so by the time the recap runs there is no one left to ask who
 * was here. This file is the ledger that survives the room emptying.
 *
 * Shape rule: each helper is at most ONE insert and ONE update. This runs once
 * per bound channel per five-second tick, so a per-member statement would turn
 * a busy guild into a write storm for data nobody reads until the room empties.
 *
 * `left_at IS NULL` is in the predicate of every write for the same reason the
 * store's `status = 'open'` is: a second empty flush must not restamp stays
 * that already closed, or every member's duration collapses to zero.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { OccupancySegment } from './channel-presence-room-recap.helpers';

const table = schema.discordChannelPresenceOccupancy;

type Db = PostgresJsDatabase<typeof schema>;

/** Members currently in the room: `discordUserId` → display name. */
export type RoomMembers = ReadonlyMap<string, string>;

/** What one flush must write to bring the ledger level with the room. */
export interface OccupancyDiff {
  /** Members in the room with no open stay — one row each to insert. */
  joins: { discordUserId: string; displayName: string }[];
  /** Ids whose open stay must be stamped `left_at`. */
  leaves: string[];
}

/**
 * Subtract the open stays from the room's current members.
 *
 * Keyed on `discordUserId` ONLY. A rename therefore changes nothing: the same
 * person keeps the same stay, which is what stops one three-hour sit from
 * splitting into two entries the moment somebody edits their nickname.
 *
 * @param open - The stays this presence row has with `left_at IS NULL`.
 * @param present - Humans the flush just resolved in the room.
 */
export function diffOccupancy(
  open: { discordUserId: string }[],
  present: RoomMembers,
): OccupancyDiff {
  const openIds = new Set(open.map((o) => o.discordUserId));
  const joins = [...present]
    .filter(([id]) => !openIds.has(id))
    .map(([discordUserId, displayName]) => ({ discordUserId, displayName }));
  const leaves = [...openIds].filter((id) => !present.has(id));
  return { joins, leaves };
}

/** The open stays of one presence row. */
async function openStays(
  db: Db,
  presenceRowId: string,
): Promise<{ discordUserId: string }[]> {
  return db
    .select({ discordUserId: table.discordUserId })
    .from(table)
    .where(
      and(eq(table.presenceMessageId, presenceRowId), isNull(table.leftAt)),
    );
}

/**
 * Bring the ledger level with the room as this flush sees it.
 *
 * Idempotent by construction: a flush that resolves the same room twice
 * computes an empty diff and issues no statement at all.
 *
 * @param present - Humans in the room, `discordUserId` → display name.
 * @param now - The flush instant; both the join stamp and the leave stamp.
 */
export async function reconcileOccupancy(
  db: Db,
  presenceRowId: string,
  present: RoomMembers,
  now: Date,
): Promise<void> {
  const { joins, leaves } = diffOccupancy(
    await openStays(db, presenceRowId),
    present,
  );
  if (joins.length > 0) {
    await db.insert(table).values(
      joins.map((j) => ({
        presenceMessageId: presenceRowId,
        discordUserId: j.discordUserId,
        displayName: j.displayName,
        joinedAt: now,
      })),
    );
  }
  if (leaves.length > 0) {
    await db
      .update(table)
      .set({ leftAt: now })
      .where(
        and(
          eq(table.presenceMessageId, presenceRowId),
          isNull(table.leftAt),
          inArray(table.discordUserId, leaves),
        ),
      );
  }
}

/**
 * Stamp every still-open stay — the room emptied, so nobody is in it.
 *
 * @param at - `empty_since`, never `now`: the recap's payload hash has to be
 *   stable across the whole grace window (S-5), and a duration that ticks
 *   forward would re-edit the message every five seconds.
 */
export async function closeAllOccupancy(
  db: Db,
  presenceRowId: string,
  at: Date,
): Promise<void> {
  await db
    .update(table)
    .set({ leftAt: at })
    .where(
      and(eq(table.presenceMessageId, presenceRowId), isNull(table.leftAt)),
    );
}

/**
 * Every stay this presence message covered, oldest first.
 *
 * Several rows for one human is expected — a re-join is a second stay, and
 * `summariseRoom` merges them. Do NOT pre-merge here: the gap between two
 * stays is real and collapsing it over-counts the time in voice.
 */
export async function listOccupancy(
  db: Db,
  presenceRowId: string,
): Promise<OccupancySegment[]> {
  return db
    .select({
      discordUserId: table.discordUserId,
      displayName: table.displayName,
      joinedAt: table.joinedAt,
      leftAt: table.leftAt,
    })
    .from(table)
    .where(eq(table.presenceMessageId, presenceRowId))
    .orderBy(table.joinedAt);
}
