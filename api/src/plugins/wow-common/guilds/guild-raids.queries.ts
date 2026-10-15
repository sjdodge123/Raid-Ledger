import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildCompositionDto } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type {
  CompositionEvent,
  ScheduleSourceRow,
} from './guild-raids.helpers';

/**
 * ROK-1787 — read queries behind `GET /plugins/wow/guilds/:id/raids` (spec
 * P6–P9). A "guild event" is tagged to the guild, not cancelled and not a
 * rescheduling-poll placeholder. No access logic here.
 */

type Db = PostgresJsDatabase<typeof schema>;

const { events, eventSignups, rosterAssignments, characters, users } = schema;

/** Upcoming/recent list length (P6). */
const LIST_LIMIT = 10;

/**
 * Signup states that count as "signed up" on a live (upcoming/running) card.
 * `departed` is excluded, matching the core event signup count.
 */
const LIVE_SIGNED = sql`('signed_up', 'tentative')`;

/**
 * Signup states that count as "signed up" on an ended card. A departed
 * member did raid (attendance resolves `departed` → attended), so it stays.
 */
const SIGNED = sql`('signed_up', 'tentative', 'departed')`;

/**
 * The outer `events.id`, table-qualified. Drizzle strips the table from a
 * column interpolated directly into a single-table select's `sql` field, so a
 * bare `${events.id}` inside `(select … from event_signups s …)` renders as
 * `"id"` and binds to `s.id` — an uncorrelated subquery. Name the table.
 */
const outerEventId = sql`${events}.${sql.identifier('id')}`;

const at = (d: Date): SQL => sql`${d.toISOString()}::timestamp`;
const ends = sql`upper(${events.duration})`;
const starts = sql`lower(${events.duration})`;

function guildEvents(guildId: number): SQL | undefined {
  return and(
    eq(events.guildId, guildId),
    isNull(events.cancelledAt),
    isNull(events.reschedulingPollId),
  );
}

/** Ended at or before `now`, within the window starting at `since`. */
function endedBetween(since: Date, now: Date): SQL {
  return sql`${ends} <= ${at(now)} and ${ends} > ${at(since)}`;
}

export interface UpcomingRow {
  id: number;
  title: string;
  duration: [Date, Date];
  slotConfig: unknown;
  maxAttendees: number | null;
  signupCount: number;
  viewerStatus: string | null;
}

export async function loadUpcoming(
  db: Db,
  guildId: number,
  viewerId: number,
  now: Date,
): Promise<UpcomingRow[]> {
  return db
    .select({
      id: events.id,
      title: events.title,
      duration: events.duration,
      slotConfig: events.slotConfig,
      maxAttendees: events.maxAttendees,
      signupCount: sql<number>`(select count(*)::int from ${eventSignups} s where s.event_id = ${outerEventId} and s.status in ${LIVE_SIGNED})`,
      viewerStatus: sql<
        string | null
      >`(select s.status from ${eventSignups} s where s.event_id = ${outerEventId} and s.user_id = ${viewerId} limit 1)`,
    })
    .from(events)
    .where(and(guildEvents(guildId), sql`${ends} > ${at(now)}`))
    .orderBy(asc(starts))
    .limit(LIST_LIMIT);
}

/** Next upcoming occurrence of every recurring series (P7). */
export async function loadScheduleRows(
  db: Db,
  guildId: number,
  now: Date,
): Promise<ScheduleSourceRow[]> {
  const rows = await db
    .selectDistinctOn([events.recurrenceGroupId], {
      id: events.id,
      title: events.title,
      duration: events.duration,
      recurrenceGroupId: events.recurrenceGroupId,
      recurrenceRule: events.recurrenceRule,
    })
    .from(events)
    .where(
      and(
        guildEvents(guildId),
        isNotNull(events.recurrenceGroupId),
        sql`${ends} > ${at(now)}`,
      ),
    )
    .orderBy(events.recurrenceGroupId, asc(starts));
  return rows.flatMap(toScheduleSource);
}

interface ScheduleQueryRow {
  id: number;
  title: string;
  duration: [Date, Date];
  recurrenceGroupId: string | null;
  recurrenceRule: unknown;
}

function toScheduleSource(r: ScheduleQueryRow): ScheduleSourceRow[] {
  if (r.recurrenceGroupId === null) return [];
  return [
    {
      id: r.id,
      title: r.title,
      startTime: r.duration[0],
      endTime: r.duration[1],
      recurrenceGroupId: r.recurrenceGroupId,
      recurrenceRule: r.recurrenceRule,
    },
  ];
}

export interface RecentRow {
  id: number;
  title: string;
  duration: [Date, Date];
  signedUp: number;
  recorded: number;
  attended: number;
}

/** Guild events that ended in the window, newest first (P6). */
export async function loadRecent(
  db: Db,
  guildId: number,
  since: Date,
  now: Date,
): Promise<RecentRow[]> {
  const s = sql`${eventSignups} s where s.event_id = ${outerEventId}`;
  return db
    .select({
      id: events.id,
      title: events.title,
      duration: events.duration,
      signedUp: sql<number>`(select count(*)::int from ${s} and s.status in ${SIGNED})`,
      recorded: sql<number>`(select count(*)::int from ${s} and s.attendance_status is not null)`,
      // Only signed-up attendees, so `attended` never exceeds `signedUp`.
      attended: sql<number>`(select count(*)::int from ${s} and s.status in ${SIGNED} and s.attendance_status = 'attended')`,
    })
    .from(events)
    .where(and(guildEvents(guildId), endedBetween(since, now)))
    .orderBy(desc(ends))
    .limit(LIST_LIMIT);
}

/** Window events with at least one signup's attendance recorded. */
async function recordedEventIds(
  db: Db,
  guildId: number,
  since: Date,
  now: Date,
): Promise<number[]> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        guildEvents(guildId),
        endedBetween(since, now),
        sql`exists (select 1 from ${eventSignups} s where s.event_id = ${outerEventId} and s.attendance_status is not null)`,
      ),
    );
  return rows.map((r) => r.id);
}

/** `of` = window events with any attendance recorded; per-user attended counts (P9). */
export async function loadAttendance(
  db: Db,
  guildId: number,
  since: Date,
  now: Date,
): Promise<{ of: number; attendedByUser: Map<number, number> }> {
  const ids = await recordedEventIds(db, guildId, since, now);
  if (ids.length === 0) return { of: 0, attendedByUser: new Map() };
  const rows = await db
    .select({
      userId: eventSignups.userId,
      n: sql<number>`count(*)::int`,
    })
    .from(eventSignups)
    .where(
      and(
        inArray(eventSignups.eventId, ids),
        eq(eventSignups.attendanceStatus, 'attended'),
        isNotNull(eventSignups.userId),
      ),
    )
    .groupBy(eventSignups.userId);
  const attendedByUser = new Map<number, number>();
  for (const r of rows)
    if (r.userId !== null) attendedByUser.set(r.userId, r.n);
  return { of: ids.length, attendedByUser };
}

export interface CompositionSource {
  event: CompositionEvent;
  filled: Map<string, number>;
  benched: GuildCompositionDto['benched'];
}

/** The next MMO-slotted guild event + its roster role counts and bench (P8). */
export async function loadCompositionSource(
  db: Db,
  guildId: number,
  now: Date,
): Promise<CompositionSource | null> {
  const [ev] = await db
    .select({
      id: events.id,
      title: events.title,
      duration: events.duration,
      slotConfig: events.slotConfig,
    })
    .from(events)
    .where(
      and(
        guildEvents(guildId),
        sql`${ends} > ${at(now)}`,
        sql`${events.slotConfig}->>'type' = 'mmo'`,
      ),
    )
    .orderBy(asc(starts))
    .limit(1);
  if (!ev) return null;
  const [filled, benched] = await Promise.all([
    roleCounts(db, ev.id),
    benchRows(db, ev.id),
  ]);
  const event = { ...ev, startTime: ev.duration[0] };
  return { event, filled, benched };
}

async function roleCounts(
  db: Db,
  eventId: number,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ role: rosterAssignments.role, n: sql<number>`count(*)::int` })
    .from(rosterAssignments)
    .where(eq(rosterAssignments.eventId, eventId))
    .groupBy(rosterAssignments.role);
  const map = new Map<string, number>();
  for (const r of rows) if (r.role !== null) map.set(r.role, r.n);
  return map;
}

async function benchRows(
  db: Db,
  eventId: number,
): Promise<GuildCompositionDto['benched']> {
  return db
    .select({
      characterId: eventSignups.characterId,
      name: sql<string>`coalesce(${characters.name}, ${users.username}, ${eventSignups.discordUsername}, 'Unknown')`,
    })
    .from(rosterAssignments)
    .innerJoin(eventSignups, eq(eventSignups.id, rosterAssignments.signupId))
    .leftJoin(characters, eq(characters.id, eventSignups.characterId))
    .leftJoin(users, eq(users.id, eventSignups.userId))
    .where(
      and(
        eq(rosterAssignments.eventId, eventId),
        eq(rosterAssignments.role, 'bench'),
        ne(eventSignups.status, 'departed'),
      ),
    )
    .orderBy(asc(rosterAssignments.position), asc(eventSignups.signedUpAt));
}
