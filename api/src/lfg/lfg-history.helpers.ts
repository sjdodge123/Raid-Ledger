/**
 * "Played here before" — `GET /lfg/:gameId/history` (ROK-1463 §B).
 *
 * Merges the two ways this community actually plays a game: scheduled events
 * and Quick Play (ad-hoc) sessions. One query per source, merged and ranked in
 * JS the way `lfg-offers.helpers.ts` does, because the two sources count their
 * participants from different tables and a UNION would have to fake one of them.
 *
 * TIMEZONE — `events.duration` is read through the drizzle `tsrange` type
 * rather than a raw `lower()/upper()` projection: the custom type interprets
 * the naive bounds as UTC (the convention the app writes with), while a raw
 * `execute` would let postgres.js parse them in the RUNNER's local zone. The
 * `WHERE` / `ORDER BY` still use `upper(duration)` — that comparison happens
 * server-side, where both sides are naive and the client zone cannot reach.
 *
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { LfgHistoryEntryDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { eligibleUser, type LfgDb } from './lfg-query.helpers';
import { LFG_HISTORY_LIMIT } from './lfg.constants';

const MINUTE_MS = 60 * 1000;

/** An event row before its participants are counted. */
interface HistoryEventRow {
  eventId: number;
  title: string;
  isAdHoc: boolean;
  startedAt: Date;
  endedAt: Date;
}

/** Who took part in one event, split by how strongly it is evidenced. */
interface Participation {
  attended: number[];
  signedUp: number[];
}

/**
 * The canonical past-event filter (`event-query-filters.helpers.ts`): finished,
 * not cancelled, and not the shell left behind by a reschedule poll.
 *
 * `events.game_id` is nullable, so the game is matched with an explicit `eq`
 * rather than a loose join — a null-game event must never land in a game's
 * history.
 */
function pastEventsForGame(gameId: number, isAdHoc: boolean) {
  return and(
    eq(schema.events.gameId, gameId),
    eq(schema.events.isAdHoc, isAdHoc),
    sql`upper(${schema.events.duration}) <= ${new Date().toISOString()}::timestamp`,
    sql`${schema.events.cancelledAt} IS NULL`,
    sql`${schema.events.reschedulingPollId} IS NULL`,
  );
}

/** Most recently finished events of one kind, capped. */
async function fetchEvents(
  db: LfgDb,
  gameId: number,
  isAdHoc: boolean,
): Promise<HistoryEventRow[]> {
  const rows = await db
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      duration: schema.events.duration,
    })
    .from(schema.events)
    .where(pastEventsForGame(gameId, isAdHoc))
    .orderBy(sql`upper(${schema.events.duration}) DESC`)
    .limit(LFG_HISTORY_LIMIT);
  return rows.map((r) => ({
    eventId: r.eventId,
    title: r.title,
    isAdHoc,
    startedAt: r.duration[0],
    endedAt: r.duration[1],
  }));
}

/**
 * Signups for the given scheduled events, eligible users only.
 *
 * `attended` is the post-event truth (ROK-421). `signedUp` is the fallback for
 * the events nobody ever recorded attendance on — without it every such entry
 * would read as "0 people played", which is a reporting gap, not a fact.
 */
async function fetchSignups(
  db: LfgDb,
  eventIds: number[],
): Promise<Map<number, Participation>> {
  const byEvent = new Map<number, Participation>();
  if (eventIds.length === 0) return byEvent;
  const rows = await db
    .select({
      eventId: schema.eventSignups.eventId,
      // The joined `users.id`, not `event_signups.user_id`: the FK column is
      // nullable (a PUG slot carries no account), and a signup with no user
      // behind it is not a participant this read can name.
      userId: schema.users.id,
      status: schema.eventSignups.status,
      attendanceStatus: schema.eventSignups.attendanceStatus,
    })
    .from(schema.eventSignups)
    .innerJoin(schema.users, eq(schema.users.id, schema.eventSignups.userId))
    .where(and(inArray(schema.eventSignups.eventId, eventIds), eligibleUser()));
  for (const row of rows) {
    const entry = byEvent.get(row.eventId) ?? { attended: [], signedUp: [] };
    if (row.attendanceStatus === 'attended') entry.attended.push(row.userId);
    if (row.status === 'signed_up') entry.signedUp.push(row.userId);
    byEvent.set(row.eventId, entry);
  }
  return byEvent;
}

/**
 * Quick Play participants, eligible users only. The `users` inner join also
 * drops the anonymous rows (`user_id IS NULL`) an unlinked Discord member
 * leaves behind.
 */
async function fetchAdHocParticipants(
  db: LfgDb,
  eventIds: number[],
): Promise<Map<number, number[]>> {
  const byEvent = new Map<number, number[]>();
  if (eventIds.length === 0) return byEvent;
  const rows = await db
    .select({
      eventId: schema.adHocParticipants.eventId,
      userId: schema.users.id,
    })
    .from(schema.adHocParticipants)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.adHocParticipants.userId),
    )
    .where(
      and(inArray(schema.adHocParticipants.eventId, eventIds), eligibleUser()),
    );
  for (const row of rows) {
    byEvent.set(row.eventId, [...(byEvent.get(row.eventId) ?? []), row.userId]);
  }
  return byEvent;
}

/**
 * Resolve participation for a merged page — ONE query per source for the whole
 * page, never one per event.
 *
 * @returns A lookup that answers for any row on the page, including the events
 *   nobody turned up to (an absent key is an empty participation, not a miss).
 */
async function fetchParticipation(
  db: LfgDb,
  rows: HistoryEventRow[],
): Promise<(row: HistoryEventRow) => Participation> {
  const idsOf = (adHoc: boolean): number[] =>
    rows.filter((e) => e.isAdHoc === adHoc).map((e) => e.eventId);
  const [signups, participants] = await Promise.all([
    fetchSignups(db, idsOf(false)),
    fetchAdHocParticipants(db, idsOf(true)),
  ]);
  return (row) =>
    row.isAdHoc
      ? { attended: participants.get(row.eventId) ?? [], signedUp: [] }
      : (signups.get(row.eventId) ?? { attended: [], signedUp: [] });
}

/** Ascending ids — a stable order the FE can diff against. */
const ascending = (ids: number[]): number[] => [...ids].sort((a, b) => a - b);

/**
 * Project one event onto the wire DTO.
 *
 * Quick Play has no signup step, so `signedUpCount` is 0 there by
 * construction — `attendedCount` already carries the whole session roster and
 * inventing a signup figure would be reporting a row that does not exist.
 */
function toEntry(
  row: HistoryEventRow,
  participation: Participation,
): LfgHistoryEntryDto {
  const attended = ascending(participation.attended);
  const signedUp = ascending(participation.signedUp);
  return {
    eventId: row.eventId,
    title: row.title,
    isAdHoc: row.isAdHoc,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    durationMinutes: Math.round(
      (row.endedAt.getTime() - row.startedAt.getTime()) / MINUTE_MS,
    ),
    attendedCount: attended.length,
    signedUpCount: signedUp.length,
    participantIds: attended.length > 0 ? attended : signedUp,
  };
}

/**
 * `GET /lfg/:gameId/history` — past sessions for the game, newest first.
 *
 * Both sources are fetched at the cap and merged, so a game with 20 recent
 * Quick Plays can still surface a scheduled raid if it finished more recently.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose history to read.
 * @returns Entries ordered by end time desc, capped at {@link LFG_HISTORY_LIMIT}.
 */
export async function listGameHistory(
  db: LfgDb,
  gameId: number,
): Promise<LfgHistoryEntryDto[]> {
  const [scheduled, adHoc] = await Promise.all([
    fetchEvents(db, gameId, false),
    fetchEvents(db, gameId, true),
  ]);
  const merged = [...scheduled, ...adHoc]
    .sort(
      (l, r) =>
        r.endedAt.getTime() - l.endedAt.getTime() || r.eventId - l.eventId,
    )
    .slice(0, LFG_HISTORY_LIMIT);
  const participationOf = await fetchParticipation(db, merged);
  return merged.map((row) => toEntry(row, participationOf(row)));
}
