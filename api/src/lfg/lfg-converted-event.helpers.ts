/**
 * The group's upcoming converted event — ROK-1573 (Lane B).
 *
 * The scheduled twin of `lfg-playing.helpers.ts::readPlayingNow`: that read
 * only ever matches a LIVE ad-hoc session (D10), so an event created from the
 * group's card ("Create event") or locked in from its poll would otherwise be
 * invisible on `/lfg/:slug`. `isAdHoc = false` here keeps the two disjoint, so
 * a group page can never show both a "playing now" card and a converted row
 * for the same event.
 *
 * Provenance is a correlated EXISTS rather than an inner join: several intents
 * point at the same event, and EXISTS answers "is it LFG-born" without the row
 * fan-out a join would need `DISTINCT` to undo.
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { LfgConvertedEventDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';

/**
 * SQL predicate: the game's LFG-born, scheduled, uncancelled event that has
 * not ended as of `now`.
 *
 * `now` is compared as an ISO literal cast to `timestamp` — the same idiom as
 * `lfg-history.helpers.ts` — because `events.duration` is a zone-less range.
 *
 * @param gameId - Game whose group is being read.
 * @param now - The instant "has not ended" is measured against.
 */
export function convertedEventWhere(
  gameId: number,
  now: Date,
): SQL | undefined {
  return and(
    eq(schema.events.gameId, gameId),
    eq(schema.events.isAdHoc, false),
    isNull(schema.events.cancelledAt),
    sql`upper(${schema.events.duration}) > ${now.toISOString()}::timestamp`,
    sql`EXISTS (
      SELECT 1 FROM lfg_intents i
      WHERE i.converted_to_event_id = ${schema.events.id}
    )`,
  );
}

/**
 * Roster head-count — the exact predicate `event-find.helpers.ts::findOneEvent`
 * uses for `signupCount`, so the LFG row and the event page agree.
 */
function signupCountSql() {
  return sql<number>`(
    SELECT COUNT(*)::int FROM event_signups s
    WHERE s.event_id = ${schema.events.id}
      AND s.status NOT IN ('roached_out', 'departed', 'declined')
  )`;
}

/**
 * `GET /lfg/:gameId` — the soonest upcoming event the group converted into.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group is being read.
 * @param now - Clock for the "not ended" cut-off (injectable for tests).
 * @returns The converted-event projection, or null when there is none.
 */
export async function readConvertedEvent(
  db: LfgDb,
  gameId: number,
  now: Date = new Date(),
): Promise<LfgConvertedEventDto | null> {
  const [row] = await db
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      duration: schema.events.duration,
      signupCount: signupCountSql(),
    })
    .from(schema.events)
    .where(convertedEventWhere(gameId, now))
    .orderBy(sql`lower(${schema.events.duration}) ASC`)
    .limit(1);
  if (!row) return null;
  return {
    eventId: row.eventId,
    title: row.title,
    startTime: row.duration[0].toISOString(),
    signupCount: Number(row.signupCount ?? 0),
  };
}
