import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GuildViewerStatusSchema,
  type GuildEventCardDto,
  type GuildRaidsDto,
  type GuildRecentEventDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

/**
 * ROK-1870 L3 — the core "events tagged to this hub" read (`events.guild_id`)
 * behind a community hub's Events tab. A core port of the WoW plugin's
 * upcoming/recent lists (no roster, so no schedule/composition/attendance).
 */

type Db = PostgresJsDatabase<typeof schema>;
const { events, eventSignups } = schema;

/** Upcoming / recent list length. */
export const HUB_EVENTS_LIMIT = 10;
/** The recent list's look-back window. */
const WINDOW_WEEKS = 8;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const outerEventId = sql`${events}.${sql.identifier('id')}`;
const at = (d: Date): SQL => sql`${d.toISOString()}::timestamp`;
const ends = sql`upper(${events.duration})`;
const starts = sql`lower(${events.duration})`;

/** `count(*)` of the outer event's signups matching `where` (raw SQL). */
const signupCount = (where: SQL): SQL<number> =>
  sql<number>`(select count(*)::int from ${eventSignups} s where s.event_id = ${outerEventId} and ${where})`;

const LIVE = sql.raw(`s.status in ('signed_up', 'tentative')`);
const SIGNED = sql.raw(`s.status in ('signed_up', 'tentative', 'departed')`);

function hubEvents(guildId: number): SQL | undefined {
  return and(
    eq(events.guildId, guildId),
    isNull(events.cancelledAt),
    isNull(events.reschedulingPollId),
  );
}

async function loadUpcoming(
  db: Db,
  guildId: number,
  viewerId: number,
  now: Date,
): Promise<GuildEventCardDto[]> {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      duration: events.duration,
      maxAttendees: events.maxAttendees,
      signupCount: signupCount(LIVE),
      viewerStatus: sql<
        string | null
      >`(select s.status from ${eventSignups} s where s.event_id = ${outerEventId} and s.user_id = ${viewerId} limit 1)`,
    })
    .from(events)
    .where(and(hubEvents(guildId), sql`${ends} > ${at(now)}`))
    .orderBy(asc(starts))
    .limit(HUB_EVENTS_LIMIT);
  return rows.map(toEventCard);
}

/** One upcoming row → the contract card. */
function toEventCard(r: {
  id: number;
  title: string;
  duration: [Date, Date];
  maxAttendees: number | null;
  signupCount: number;
  viewerStatus: string | null;
}): GuildEventCardDto {
  const status = GuildViewerStatusSchema.safeParse(r.viewerStatus);
  return {
    id: r.id,
    title: r.title,
    startTime: r.duration[0].toISOString(),
    endTime: r.duration[1].toISOString(),
    signupCount: r.signupCount,
    needed: r.maxAttendees,
    viewerStatus: status.success ? status.data : null,
  };
}

async function loadRecent(
  db: Db,
  guildId: number,
  now: Date,
): Promise<GuildRecentEventDto[]> {
  const since = new Date(now.getTime() - WINDOW_WEEKS * WEEK_MS);
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      duration: events.duration,
      signedUp: signupCount(SIGNED),
      attended: signupCount(sql.raw(`s.attendance_status = 'attended'`)),
      recorded: signupCount(sql.raw(`s.attendance_status is not null`)),
    })
    .from(events)
    .where(
      and(
        hubEvents(guildId),
        sql`${ends} <= ${at(now)} and ${ends} > ${at(since)}`,
      ),
    )
    .orderBy(desc(ends))
    .limit(HUB_EVENTS_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startTime: r.duration[0].toISOString(),
    signedUp: r.signedUp,
    attended: r.recorded > 0 ? r.attended : null,
  }));
}

/** The hub's Events tab payload: upcoming + recent tagged events. */
export async function loadCommunityHubEvents(
  db: Db,
  guildId: number,
  viewerId: number,
  now: Date = new Date(),
): Promise<GuildRaidsDto> {
  const [upcoming, recent] = await Promise.all([
    loadUpcoming(db, guildId, viewerId, now),
    loadRecent(db, guildId, now),
  ]);
  return {
    upcoming,
    recent,
    schedule: [],
    composition: null,
    attendance: { windowWeeks: WINDOW_WEEKS, rows: [] },
    nextRaid: upcoming.find((c) => new Date(c.startTime) > now) ?? null,
  };
}
