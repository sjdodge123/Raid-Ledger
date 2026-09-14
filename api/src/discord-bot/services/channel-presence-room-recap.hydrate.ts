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
import { and, eq, gt, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { listOccupancy } from './channel-presence-occupancy.helpers';
import {
  summariseRoom,
  type ActivitySegment,
  type OccupancySegment,
  type RoomRecap,
} from './channel-presence-room-recap.helpers';
import type { PresenceRow } from './channel-presence-store.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Every play session that overlapped the span, for the people who were in the
 * room.
 *
 * `name` falls back to `discord_activity_name` when the session never mapped
 * to a games row — that is how an unmapped title still appears in the recap
 * instead of vanishing.
 */
function overlapsSpan(
  discordUserIds: string[],
  span: { openedAt: Date; endedAt: Date },
): SQL {
  return and(
    inArray(schema.users.discordId, discordUserIds),
    lt(schema.gameActivitySessions.startedAt, span.endedAt),
    or(
      isNull(schema.gameActivitySessions.endedAt),
      gt(schema.gameActivitySessions.endedAt, span.openedAt),
    ),
  ) as SQL;
}

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
  return rows.map(toSegment);
}

/** A session row as a recap segment; an unmapped title keeps its Discord name. */
function toSegment(r: {
  discordUserId: string | null;
  gameName: string | null;
  activityName: string;
  startedAt: Date;
  endedAt: Date | null;
}): ActivitySegment {
  return {
    discordUserId: r.discordUserId ?? '',
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
  const occupancy: OccupancySegment[] = await listOccupancy(db, row.id);
  const span = { openedAt: row.openedAt, endedAt };
  const ids = [...new Set(occupancy.map((o) => o.discordUserId))];
  const activities = await loadRoomActivities(db, ids, span);
  return summariseRoom(occupancy, activities, span);
}
