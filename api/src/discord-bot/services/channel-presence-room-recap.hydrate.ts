/**
 * ROK-1499 — read the room's span out of the database at recap time.
 *
 * Layer 1 (`summariseRoom`) is pure arithmetic; this is the only thing that
 * touches the DB. Two reads: the occupancy ledger for who was in voice, and
 * `game_activity_sessions` for what they were playing.
 *
 * The activity predicate is an OVERLAP, not "started inside the window" — the
 * same trap `recapEvents` documents. Someone who launched the game before they
 * joined voice (the normal case: you start the game, THEN hop in) has a
 * session that began before `opened_at`, and a `started_at >= opened_at`
 * predicate drops exactly the game the room spent three hours on.
 */
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  listOccupancy,
  type OccupancyRow,
} from './channel-presence-occupancy.helpers';
import {
  summariseRoom,
  type ActivitySegment,
  type RoomRecap,
} from './channel-presence-room-recap.helpers';
import type { PresenceRow } from './channel-presence-store.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * How far before the span a session may have started and still count.
 *
 * Without a lower bound an orphaned row — `ended_at IS NULL` because the bot
 * missed the presence update that closed it, weeks ago — is "still running"
 * forever and inflates its game across the WHOLE span, every time. A day is
 * generous for a real sitting and ruthless for a leak.
 */
const MAX_SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** The overlap predicate: sessions that intersect the recap window. */
function overlapsSpan(
  discordUserIds: string[],
  span: { openedAt: Date; endedAt: Date },
): SQL {
  const floor = new Date(span.openedAt.getTime() - MAX_SESSION_LOOKBACK_MS);
  return and(
    inArray(schema.users.discordId, discordUserIds),
    gte(schema.gameActivitySessions.startedAt, floor),
    lt(schema.gameActivitySessions.startedAt, span.endedAt),
    or(
      isNull(schema.gameActivitySessions.endedAt),
      gt(schema.gameActivitySessions.endedAt, span.openedAt),
    ),
  ) as SQL;
}

/**
 * Every play session that overlapped the span, for the people who were in the
 * room.
 *
 * `name` falls back to `discord_activity_name` when the session never mapped
 * to a games row — that is how an unmapped title still appears in the recap
 * instead of vanishing.
 */
export async function loadRoomActivities(
  db: Db,
  discordUserIds: string[],
  span: { openedAt: Date; endedAt: Date },
): Promise<ActivitySegment[]> {
  if (discordUserIds.length === 0) return [];
  const rows = await db
    .select({
      discordUserId: schema.users.discordId,
      gameName: schema.games.name,
      activityName: schema.gameActivitySessions.discordActivityName,
      startedAt: schema.gameActivitySessions.startedAt,
      endedAt: schema.gameActivitySessions.endedAt,
    })
    .from(schema.gameActivitySessions)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.gameActivitySessions.userId),
    )
    .leftJoin(
      schema.games,
      eq(schema.games.id, schema.gameActivitySessions.gameId),
    )
    .where(overlapsSpan(discordUserIds, span));
  // A null `discord_id` cannot belong to anyone in the room (the id list came
  // FROM the occupancy rows), and mapping it to '' would invent a member key
  // that quietly matches every other nulled row.
  return rows.filter(hasDiscordId).map(toSegment);
}

/** Narrow away the nullable `discord_id` the users join may produce. */
function hasDiscordId<T extends { discordUserId: string | null }>(
  row: T,
): row is T & { discordUserId: string } {
  return row.discordUserId !== null;
}

/** A session row as a recap segment; an unmapped title keeps its Discord name. */
function toSegment(r: {
  discordUserId: string;
  gameName: string | null;
  activityName: string;
  startedAt: Date;
  endedAt: Date | null;
}): ActivitySegment {
  return {
    discordUserId: r.discordUserId,
    name: r.gameName ?? r.activityName,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

/**
 * Build the recap's room summary for one presence row.
 *
 * @param endedAt - `empty_since`, never `now`. The recap's payload hash must
 *   be stable for the whole grace window (S-5) — a span that grows every tick
 *   re-edits the message five seconds at a time.
 */
export async function hydrateRoomRecap(
  db: Db,
  row: PresenceRow,
  endedAt: Date,
): Promise<RoomRecap> {
  const occupancy: OccupancyRow[] = await listOccupancy(db, row.id);
  const span = { openedAt: row.openedAt, endedAt };
  const ids = [...new Set(occupancy.map((o) => o.discordUserId))];
  const tracked = await loadRoomActivities(db, ids, span);
  const activities = [
    ...tracked,
    ...(await occupancyActivities(db, occupancy, tracked)),
  ];
  return summariseRoom(occupancy, activities, span);
}

/**
 * The games the session table never knew about (ROK-1499 P2-2).
 *
 * `game_activity_sessions` only has rows for LINKED Raid Ledger users, and
 * none at all for a `/playing` manual override — so an unlinked occupant
 * showed a game on the live embed all evening and then vanished from the
 * recap. The occupancy ledger recorded what the room read them as playing, so
 * fall back to the stay itself.
 *
 * A tracked session always WINS: it has real start/stop instants, where the
 * stay can only say "for as long as they were in the room".
 */
async function occupancyActivities(
  db: Db,
  occupancy: OccupancyRow[],
  tracked: ActivitySegment[],
): Promise<ActivitySegment[]> {
  const covered = new Set(tracked.map((a) => a.discordUserId));
  const stays = occupancy.filter(
    (o) => !covered.has(o.discordUserId) && hasGame(o),
  );
  if (stays.length === 0) return [];
  const names = await gameNames(db, stays);
  return stays.map((o) => ({
    discordUserId: o.discordUserId,
    name: (o.gameId === null ? null : names.get(o.gameId)) ?? o.activityName!,
    startedAt: o.joinedAt,
    endedAt: o.leftAt,
  }));
}

/** A stay only contributes play time if the room read a game off it. */
function hasGame(o: OccupancyRow): boolean {
  return o.gameId !== null || o.activityName !== null;
}

/**
 * Current names for the stays' games — the stored `activity_name` is only the
 * fallback for a games row that has since been deleted.
 */
async function gameNames(
  db: Db,
  stays: OccupancyRow[],
): Promise<Map<number, string>> {
  const ids = [
    ...new Set(stays.map((o) => o.gameId).filter((id) => id !== null)),
  ];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(inArray(schema.games.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
