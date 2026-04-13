/**
 * Dashboard data-fetching queries.
 */
import { eq, gte, lte, and, ne, asc, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type EventRow = {
  events: typeof schema.events.$inferSelect;
  users: typeof schema.users.$inferSelect | null;
  games: typeof schema.games.$inferSelect | null;
  signupCount: number;
};

/** Builds the signup count subquery shared by dashboard queries. */
function buildSignupSubquery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({
      eventId: schema.eventSignups.eventId,
      count: sql<number>`count(*)`.as('signup_count'),
    })
    .from(schema.eventSignups)
    .where(
      and(
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'departed'),
        ne(schema.eventSignups.status, 'declined'),
      ),
    )
    .groupBy(schema.eventSignups.eventId)
    .as('signup_counts');
}

/** Builds filter conditions for upcoming, non-cancelled events. */
function buildDashboardConditions(
  userId: number,
  isAdmin: boolean,
): ReturnType<typeof gte>[] {
  const now = new Date().toISOString();
  const conds: ReturnType<typeof gte>[] = [
    gte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
    sql`${schema.events.cancelledAt} IS NULL`,
    sql`${schema.events.reschedulingPollId} IS NULL`,
  ];
  if (!isAdmin) conds.push(eq(schema.events.creatorId, userId));
  return conds;
}

/** Queries upcoming events with signup counts for the dashboard. */
export async function queryDashboardData(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  isAdmin: boolean,
): Promise<{ events: EventRow[]; eventIds: number[] }> {
  const conditions = buildDashboardConditions(userId, isAdmin);
  const sq = buildSignupSubquery(db);
  const events = await db
    .select({
      events: schema.events,
      users: schema.users,
      games: schema.games,
      signupCount: sql<number>`coalesce(${sq.count}, 0)`,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
    .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
    .leftJoin(sq, eq(schema.events.id, sq.eventId))
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${schema.events.duration})`));
  return { events, eventIds: events.map((e) => e.events.id) };
}

/** Counts unconfirmed signups per event. */
export async function queryUnconfirmedCounts(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      eventId: schema.eventSignups.eventId,
      count: sql<number>`count(*)`.as('unconfirmed_count'),
    })
    .from(schema.eventSignups)
    .where(
      and(
        inArray(schema.eventSignups.eventId, eventIds),
        eq(schema.eventSignups.confirmationStatus, 'pending'),
      ),
    )
    .groupBy(schema.eventSignups.eventId);
  return new Map(rows.map((r) => [r.eventId, Number(r.count)]));
}

/** Counts roster assignments per event per role. */
export async function queryAssignmentCounts(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
): Promise<Map<number, Map<string, number>>> {
  const rows = await db
    .select({
      eventId: schema.rosterAssignments.eventId,
      role: schema.rosterAssignments.role,
      count: sql<number>`count(*)`.as('assigned_count'),
    })
    .from(schema.rosterAssignments)
    .where(inArray(schema.rosterAssignments.eventId, eventIds))
    .groupBy(schema.rosterAssignments.eventId, schema.rosterAssignments.role);
  const map = new Map<number, Map<string, number>>();
  for (const row of rows) {
    if (!map.has(row.eventId)) map.set(row.eventId, new Map());
    map.get(row.eventId)!.set(row.role ?? 'player', Number(row.count));
  }
  return map;
}

/** Computes attendance rate metrics for past events. */
export async function queryAttendanceMetrics(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  isAdmin: boolean,
): Promise<{ attendanceRate?: number; noShowRate?: number }> {
  const rows = await fetchAttendanceRows(db, userId, isAdmin);
  return computeRates(rows);
}

/** Fetches attendance status counts from past events. */
async function fetchAttendanceRows(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  isAdmin: boolean,
) {
  const now = new Date().toISOString();
  const conds: ReturnType<typeof gte>[] = [
    lte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
    sql`${schema.events.cancelledAt} IS NULL`,
    sql`${schema.events.reschedulingPollId} IS NULL`,
  ];
  if (!isAdmin) conds.push(eq(schema.events.creatorId, userId));
  return db
    .select({
      attendanceStatus: schema.eventSignups.attendanceStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.eventSignups)
    .innerJoin(schema.events, eq(schema.eventSignups.eventId, schema.events.id))
    .where(
      and(
        ...conds,
        sql`${schema.eventSignups.attendanceStatus} IS NOT NULL`,
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'departed'),
      ),
    )
    .groupBy(schema.eventSignups.attendanceStatus);
}

/** Computes attendance and no-show rates from raw counts. */
function computeRates(
  rows: { attendanceStatus: string | null; count: number }[],
): { attendanceRate?: number; noShowRate?: number } {
  let attended = 0;
  let noShow = 0;
  let total = 0;
  for (const row of rows) {
    const c = Number(row.count);
    total += c;
    if (row.attendanceStatus === 'attended') attended = c;
    if (row.attendanceStatus === 'no_show') noShow = c;
  }
  if (total === 0) return {};
  return {
    attendanceRate: Math.round((attended / total) * 100) / 100,
    noShowRate: Math.round((noShow / total) * 100) / 100,
  };
}
