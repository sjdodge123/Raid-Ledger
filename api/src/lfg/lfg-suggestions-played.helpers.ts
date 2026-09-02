/**
 * The `played` signal behind `GET /lfg/:gameId/suggestions` (ROK-1463 §C).
 *
 * "Played" means either half of how this community plays: a scheduled event
 * the user was marked `attended` on (ROK-421), or a Quick Play session they
 * appear in as an `ad_hoc_participants` row. Split out of
 * `lfg-suggestions.helpers.ts` so that file stays a readable statement of the
 * reason/exclusion/ranking rules rather than three shapes of event SQL.
 *
 * TIMEZONE — `events.duration` is read through the drizzle `tsrange` type, not
 * a raw `upper()` projection, for the reason documented in
 * `lfg-history.helpers.ts`. The window comparison stays server-side.
 *
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A finished, uncancelled, non-shell event for the game inside the window. */
function playableEvent(gameId: number, since: Date) {
  const now = new Date();
  return and(
    eq(schema.events.gameId, gameId),
    sql`upper(${schema.events.duration}) <= ${now.toISOString()}::timestamp`,
    sql`upper(${schema.events.duration}) >= ${since.toISOString()}::timestamp`,
    sql`${schema.events.cancelledAt} IS NULL`,
    sql`${schema.events.reschedulingPollId} IS NULL`,
  );
}

/** Users marked `attended` on a scheduled event for the game. */
function fetchAttendees(db: LfgDb, gameId: number, since: Date) {
  return db
    .select({
      userId: schema.eventSignups.userId,
      duration: schema.events.duration,
    })
    .from(schema.eventSignups)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventSignups.eventId))
    .where(
      and(
        playableEvent(gameId, since),
        eq(schema.eventSignups.attendanceStatus, 'attended'),
      ),
    );
}

/** Users recorded in a Quick Play session for the game. */
function fetchQuickPlayers(db: LfgDb, gameId: number, since: Date) {
  return (
    db
      .select({
        userId: schema.users.id,
        duration: schema.events.duration,
      })
      .from(schema.adHocParticipants)
      .innerJoin(
        schema.events,
        eq(schema.events.id, schema.adHocParticipants.eventId),
      )
      // Inner-joined so an unlinked Discord participant (`user_id IS NULL`)
      // cannot become a suggestion with no account behind it.
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.adHocParticipants.userId),
      )
      .where(and(playableEvent(gameId, since), eq(schema.events.isAdHoc, true)))
  );
}

/**
 * Everyone who played this game recently, with the instant they last finished.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game to look for.
 * @param days - How far back a session still counts.
 * @returns userId -> most recent session end. Eligibility is applied later,
 *   once by the profile read, rather than twice here.
 */
export async function fetchPlayedForGame(
  db: LfgDb,
  gameId: number,
  days: number,
): Promise<Map<number, Date>> {
  const since = new Date(Date.now() - days * DAY_MS);
  const [attendees, quickPlayers] = await Promise.all([
    fetchAttendees(db, gameId, since),
    fetchQuickPlayers(db, gameId, since),
  ]);
  const lastPlayed = new Map<number, Date>();
  for (const row of [...attendees, ...quickPlayers]) {
    const endedAt = row.duration[1];
    const current = lastPlayed.get(row.userId);
    if (!current || endedAt > current) lastPlayed.set(row.userId, endedAt);
  }
  return lastPlayed;
}
