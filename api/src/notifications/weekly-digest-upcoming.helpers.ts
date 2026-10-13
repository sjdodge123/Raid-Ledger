/**
 * Weekly Discord digest — "📅 Coming up" reads (ROK-1771 slice L1, rows D1/D2).
 *
 * D1 — scheduled events starting in the next 7 days. The date-range, cancelled
 * and ad-hoc predicates come from the events list's own
 * `buildFilterConditions` (event-query-filters.helpers.ts), so "upcoming"
 * means the same thing here as on the events page. Starting at `now` drops
 * past and already-running events; titles and an aggregate sign-up count
 * only, never attendee names.
 *
 * D2 — public standalone scheduling polls still waiting for votes, using the
 * shared viewer-free `votableStandalonePollSql` predicate (the same one the
 * events-page banner uses) plus `visibility = 'public'`. Counts only.
 *
 * Times are returned as UTC instants (`Date`); the render lane formats them
 * as Discord timestamps (operator ruling 2026-10-12, Q11).
 */
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { buildFilterConditions } from '../events/event-query-filters.helpers';
import { votableStandalonePollSql } from '../lineups/standalone-poll/standalone-poll-votable.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const UPCOMING_WINDOW_DAYS = 7;
export const UPCOMING_EVENT_LIMIT = 10;
export const UPCOMING_POLL_LIMIT = 5;

const DAY_MS = 86_400_000;

/** Numeric columns postgres-js may hand back as text. */
type Num = number | string | null;

export type UpcomingEventRow = {
  id: number;
  title: string;
  gameName: string | null;
  startsAtMs: Num;
  signupCount: Num;
};

export type UpcomingPollRow = {
  matchId: number;
  lineupId: number;
  gameName: string;
  deadlineMs: Num;
  memberCount: Num;
  openSlotCount: Num;
};

export interface UpcomingEvent {
  eventId: number;
  title: string;
  gameName: string | null;
  /** UTC instant the event starts. */
  startsAt: Date;
  /** Active sign-ups (not roached out, departed or declined). */
  signupCount: number;
}

export interface UpcomingPoll {
  matchId: number;
  lineupId: number;
  gameName: string;
  /** UTC instant voting closes; `null` when the poll has no deadline. */
  deadline: Date | null;
  memberCount: number;
  /** Proposed times still in the future (0 = waiting for suggestions). */
  openSlotCount: number;
}

export interface WeeklyUpcoming {
  events: UpcomingEvent[];
  polls: UpcomingPoll[];
}

/** Filter conditions for events starting in `[now, now + 7d]`. */
export function upcomingEventConditions(now: Date): SQL[] {
  const end = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * DAY_MS);
  return buildFilterConditions(
    {
      page: 1,
      limit: UPCOMING_EVENT_LIMIT,
      startAfter: now.toISOString(),
      endBefore: end.toISOString(),
      includeAdHoc: 'false',
    },
    undefined,
  );
}

const SIGNUP_COUNT = sql<Num>`(
  SELECT COUNT(*)::int FROM event_signups es
  WHERE es.event_id = ${schema.events.id}
    AND es.status NOT IN ('roached_out', 'departed', 'declined')
)`;

/** Events starting in the next 7 days, soonest first. */
export async function fetchUpcomingEventRows(
  db: Db,
  now: Date,
): Promise<UpcomingEventRow[]> {
  const startsAt = sql`lower(${schema.events.duration})`;
  return db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      gameName: schema.games.name,
      startsAtMs: sql<Num>`(EXTRACT(EPOCH FROM ${startsAt}) * 1000)::float8`,
      signupCount: SIGNUP_COUNT,
    })
    .from(schema.events)
    .leftJoin(schema.games, eq(schema.games.id, schema.events.gameId))
    .where(and(...upcomingEventConditions(now)))
    .orderBy(asc(startsAt), asc(schema.events.id))
    .limit(UPCOMING_EVENT_LIMIT);
}

/** Public, genuinely votable standalone polls — closing soonest first. */
export function buildUpcomingPollsQuery(): SQL {
  return sql`
    SELECT m.id AS "matchId", m.lineup_id AS "lineupId", g.name AS "gameName",
           (EXTRACT(EPOCH FROM l.phase_deadline) * 1000)::float8 AS "deadlineMs",
           (SELECT COUNT(*)::int FROM community_lineup_match_members mm
              WHERE mm.match_id = m.id) AS "memberCount",
           (SELECT COUNT(*)::int FROM community_lineup_schedule_slots os
              WHERE os.match_id = m.id AND os.proposed_time > NOW()) AS "openSlotCount"
    FROM community_lineup_matches m
    JOIN community_lineups l ON l.id = m.lineup_id
    JOIN games g ON g.id = m.game_id
    WHERE ${votableStandalonePollSql()}
      AND l.visibility = 'public'
    ORDER BY l.phase_deadline ASC NULLS LAST, m.id ASC
    LIMIT ${sql.raw(String(UPCOMING_POLL_LIMIT))}
  `;
}

export async function fetchUpcomingPollRows(
  db: Db,
): Promise<UpcomingPollRow[]> {
  return [...(await db.execute<UpcomingPollRow>(buildUpcomingPollsQuery()))];
}

/** Coerce a count to a non-negative integer; junk and null become 0. */
function toCount(value: Num | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** Epoch milliseconds → `Date`; null/junk → null. */
function toInstant(value: Num | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = Number(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** One event row → typed event; a row with no usable start is dropped. */
export function shapeUpcomingEvent(
  row: UpcomingEventRow,
): UpcomingEvent | null {
  const startsAt = toInstant(row.startsAtMs);
  if (!startsAt) return null;
  return {
    eventId: row.id,
    title: row.title,
    gameName: row.gameName,
    startsAt,
    signupCount: toCount(row.signupCount),
  };
}

export function shapeUpcomingPoll(row: UpcomingPollRow): UpcomingPoll {
  return {
    matchId: row.matchId,
    lineupId: row.lineupId,
    gameName: row.gameName,
    deadline: toInstant(row.deadlineMs),
    memberCount: toCount(row.memberCount),
    openSlotCount: toCount(row.openSlotCount),
  };
}

/** Shape both reads; `null` when there is nothing coming up at all. */
export function shapeWeeklyUpcoming(
  eventRows: readonly UpcomingEventRow[],
  pollRows: readonly UpcomingPollRow[],
): WeeklyUpcoming | null {
  const events = eventRows
    .map(shapeUpcomingEvent)
    .filter((e): e is UpcomingEvent => e !== null);
  const polls = pollRows.map(shapeUpcomingPoll);
  return events.length === 0 && polls.length === 0 ? null : { events, polls };
}

/** Run both "Coming up" reads against the live database. */
export async function fetchWeeklyUpcoming(
  db: Db,
  options: { now?: Date } = {},
): Promise<WeeklyUpcoming | null> {
  const now = options.now ?? new Date();
  const [eventRows, pollRows] = await Promise.all([
    fetchUpcomingEventRows(db, now),
    fetchUpcomingPollRows(db),
  ]);
  return shapeWeeklyUpcoming(eventRows, pollRows);
}
