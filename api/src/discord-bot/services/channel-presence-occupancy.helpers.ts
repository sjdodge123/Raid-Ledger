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

/**
 * A stay as stored: layer 1's segment plus the room's reading of what the
 * member was playing, which is what rescues an unlinked occupant's game.
 */
export type OccupancyRow = OccupancySegment & DetectedGame;

const table = schema.discordChannelPresenceOccupancy;

type Db = PostgresJsDatabase<typeof schema>;

/** What presence detection said a member was playing on this flush. */
export interface DetectedGame {
  /** `null` = presence produced no game, or it maps to no `games` row. */
  gameId: number | null;
  /** The group's rendered name, kept as a fallback; never a placeholder. */
  activityName: string | null;
}

/** One human in the room right now, as the flush resolved them. */
export interface RoomMember extends DetectedGame {
  displayName: string;
}

/** Members currently in the room, keyed by `discordUserId`. */
export type RoomMembers = ReadonlyMap<string, RoomMember>;

/** An open stay, as the diff needs to see it. */
export interface OpenStay extends DetectedGame {
  discordUserId: string;
}

/** What one flush must write to bring the ledger level with the room. */
export interface OccupancyDiff {
  /** Members in the room with no open stay — one row each to insert. */
  joins: (RoomMember & { discordUserId: string })[];
  /** Ids whose open stay must be stamped `left_at`. */
  leaves: string[];
  /**
   * Members whose stay is open but whose detected game has MOVED. The stay is
   * updated rather than split: the synthetic segment it feeds is only ever
   * used for someone with no `game_activity_sessions` row at all, and for
   * them the room's current reading is the only reading there is.
   */
  changes: OpenStay[];
}

/** Did the room's reading of this member's game move since the last flush? */
function gameMoved(open: DetectedGame, present: DetectedGame): boolean {
  return (
    open.gameId !== present.gameId || open.activityName !== present.activityName
  );
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
  open: OpenStay[],
  present: RoomMembers,
): OccupancyDiff {
  const byId = new Map(open.map((o) => [o.discordUserId, o]));
  const joins = [...present]
    .filter(([id]) => !byId.has(id))
    .map(([discordUserId, member]) => ({ discordUserId, ...member }));
  const leaves = [...byId.keys()].filter((id) => !present.has(id));
  const changes = [...present]
    .filter(([id, m]) => byId.has(id) && gameMoved(byId.get(id)!, m))
    .map(([discordUserId, m]) => ({
      discordUserId,
      gameId: m.gameId,
      activityName: m.activityName,
    }));
  return { joins, leaves, changes };
}

/** The open stays of one presence row. */
async function openStays(db: Db, presenceRowId: string): Promise<OpenStay[]> {
  return db
    .select({
      discordUserId: table.discordUserId,
      gameId: table.gameId,
      activityName: table.activityName,
    })
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
  const { joins, leaves, changes } = diffOccupancy(
    await openStays(db, presenceRowId),
    present,
  );
  if (joins.length > 0) await openStaysFor(db, presenceRowId, joins, now);
  if (leaves.length > 0) await closeStaysFor(db, presenceRowId, leaves, now);
  for (const [game, ids] of groupByGame(changes)) {
    await retitleStays(db, presenceRowId, ids, game);
  }
}

/**
 * Collapse the changed stays to one statement per distinct game.
 *
 * A loop over MEMBERS would be a write per occupant per tick; a room only ever
 * has a handful of distinct games, and in the common case (a group all
 * switching together) this is a single update.
 */
function groupByGame(changes: OpenStay[]): Map<string, string[]> {
  const byGame = new Map<string, string[]>();
  for (const c of changes) {
    const key = JSON.stringify([c.gameId, c.activityName]);
    byGame.set(key, [...(byGame.get(key) ?? []), c.discordUserId]);
  }
  return byGame;
}

/** Point the named members' open stays at the game the room now reports. */
async function retitleStays(
  db: Db,
  presenceRowId: string,
  discordUserIds: string[],
  gameKey: string,
): Promise<void> {
  const [gameId, activityName] = JSON.parse(gameKey) as [
    number | null,
    string | null,
  ];
  await db
    .update(table)
    .set({ gameId, activityName })
    .where(
      and(
        eq(table.presenceMessageId, presenceRowId),
        isNull(table.leftAt),
        inArray(table.discordUserId, discordUserIds),
      ),
    );
}

/** One insert for every member who just appeared in the room. */
async function openStaysFor(
  db: Db,
  presenceRowId: string,
  joins: OccupancyDiff['joins'],
  now: Date,
): Promise<void> {
  await db.insert(table).values(
    joins.map((j) => ({
      presenceMessageId: presenceRowId,
      discordUserId: j.discordUserId,
      displayName: j.displayName,
      gameId: j.gameId,
      activityName: j.activityName,
      joinedAt: now,
    })),
  );
}

/** One update for every member who just disappeared from it. */
async function closeStaysFor(
  db: Db,
  presenceRowId: string,
  leaves: string[],
  now: Date,
): Promise<void> {
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
): Promise<OccupancyRow[]> {
  return db
    .select({
      discordUserId: table.discordUserId,
      displayName: table.displayName,
      gameId: table.gameId,
      activityName: table.activityName,
      joinedAt: table.joinedAt,
      leftAt: table.leftAt,
    })
    .from(table)
    .where(eq(table.presenceMessageId, presenceRowId))
    .orderBy(table.joinedAt);
}
