import { eq, gte, lte, and, ne, asc, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  DashboardResponseDto,
  DashboardEventDto,
  EventResponseDto,
} from '@raid-ledger/contract';

type SlotConfig = {
  type?: string;
  tank?: number;
  healer?: number;
  dps?: number;
  flex?: number;
  player?: number;
  bench?: number;
} | null;

type EventRow = {
  events: typeof schema.events.$inferSelect;
  users: typeof schema.users.$inferSelect | null;
  games: typeof schema.games.$inferSelect | null;
  signupCount: number;
};

export function computeRosterMetrics(
  slotConfig: SlotConfig,
  assignments: Map<string, number>,
  signupCount: number,
  maxAttendees: number | null,
): { rosterFillPercent: number; missingRoles: string[]; hasSlots: boolean } {
  const missingRoles: string[] = [];
  let rosterFillPercent = 0;
  let hasSlots = false;

  if (slotConfig) {
    const roles =
      slotConfig.type === 'mmo'
        ? (['tank', 'healer', 'dps', 'flex'] as const)
        : (['player'] as const);

    let totalSlots = 0;
    let filledSlots = 0;

    for (const role of roles) {
      const needed = slotConfig[role] ?? 0;
      if (needed === 0) continue;
      totalSlots += needed;
      const assigned = assignments.get(role) ?? 0;
      filledSlots += Math.min(assigned, needed);
      if (assigned < needed) {
        missingRoles.push(`${needed - assigned} ${role}`);
      }
    }

    rosterFillPercent =
      totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;
    hasSlots = true;
  } else if (maxAttendees) {
    rosterFillPercent = Math.round((signupCount / maxAttendees) * 100);
    hasSlots = true;
  }

  return { rosterFillPercent, missingRoles, hasSlots };
}

export async function queryDashboardData(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  isAdmin: boolean,
): Promise<{
  events: EventRow[];
  eventIds: number[];
}> {
  const now = new Date().toISOString();
  const conditions: ReturnType<typeof gte>[] = [
    gte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
    sql`${schema.events.cancelledAt} IS NULL`,
  ];
  if (!isAdmin) {
    conditions.push(eq(schema.events.creatorId, userId));
  }
  const whereCondition = and(...conditions);

  const signupCountSubquery = db
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

  const events = await db
    .select({
      events: schema.events,
      users: schema.users,
      games: schema.games,
      signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
    .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
    .leftJoin(
      signupCountSubquery,
      eq(schema.events.id, signupCountSubquery.eventId),
    )
    .where(whereCondition)
    .orderBy(asc(sql`lower(${schema.events.duration})`));

  return {
    events,
    eventIds: events.map((e) => e.events.id),
  };
}

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
    .groupBy(
      schema.rosterAssignments.eventId,
      schema.rosterAssignments.role,
    );

  const map = new Map<number, Map<string, number>>();
  for (const row of rows) {
    if (!map.has(row.eventId)) {
      map.set(row.eventId, new Map());
    }
    map.get(row.eventId)!.set(row.role ?? 'player', Number(row.count));
  }
  return map;
}

export async function queryAttendanceMetrics(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  isAdmin: boolean,
): Promise<{ attendanceRate?: number; noShowRate?: number }> {
  const now = new Date().toISOString();
  const conditions: ReturnType<typeof gte>[] = [
    lte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
    sql`${schema.events.cancelledAt} IS NULL`,
  ];
  if (!isAdmin) {
    conditions.push(eq(schema.events.creatorId, userId));
  }

  const rows = await db
    .select({
      attendanceStatus: schema.eventSignups.attendanceStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.eventSignups)
    .innerJoin(
      schema.events,
      eq(schema.eventSignups.eventId, schema.events.id),
    )
    .where(
      and(
        ...conditions,
        sql`${schema.eventSignups.attendanceStatus} IS NOT NULL`,
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'departed'),
      ),
    )
    .groupBy(schema.eventSignups.attendanceStatus);

  let totalAttended = 0;
  let totalNoShow = 0;
  let totalMarked = 0;
  for (const row of rows) {
    const count = Number(row.count);
    totalMarked += count;
    if (row.attendanceStatus === 'attended') totalAttended = count;
    if (row.attendanceStatus === 'no_show') totalNoShow = count;
  }

  return {
    attendanceRate:
      totalMarked > 0
        ? Math.round((totalAttended / totalMarked) * 100) / 100
        : undefined,
    noShowRate:
      totalMarked > 0
        ? Math.round((totalNoShow / totalMarked) * 100) / 100
        : undefined,
  };
}

export function buildDashboardEvents(
  events: EventRow[],
  mapToResponse: (row: EventRow) => EventResponseDto,
  assignmentMap: Map<number, Map<string, number>>,
  unconfirmedMap: Map<number, number>,
): {
  dashboardEvents: DashboardEventDto[];
  totalSignups: number;
  averageFillRate: number;
  eventsWithRosterGaps: number;
} {
  let totalSignups = 0;
  let totalFillRateSum = 0;
  let eventsWithSlots = 0;
  let eventsWithGaps = 0;

  const dashboardEvents: DashboardEventDto[] = events.map((row) => {
    const base = mapToResponse(row);
    const signupCount = Number(row.signupCount);
    totalSignups += signupCount;

    const slotConfig = row.events.slotConfig as SlotConfig;
    const assignments =
      assignmentMap.get(row.events.id) ?? new Map<string, number>();

    const metrics = computeRosterMetrics(
      slotConfig,
      assignments,
      signupCount,
      row.events.maxAttendees,
    );

    if (metrics.hasSlots) {
      eventsWithSlots++;
      totalFillRateSum += metrics.rosterFillPercent;
      if (metrics.missingRoles.length > 0) {
        eventsWithGaps++;
      }
    }

    // Original also counted maxAttendees shortfall as a gap
    if (
      !row.events.slotConfig &&
      row.events.maxAttendees &&
      signupCount < row.events.maxAttendees
    ) {
      eventsWithGaps++;
    }

    return {
      ...base,
      rosterFillPercent: metrics.rosterFillPercent,
      unconfirmedCount: unconfirmedMap.get(row.events.id) ?? 0,
      missingRoles: metrics.missingRoles,
    };
  });

  return {
    dashboardEvents,
    totalSignups,
    averageFillRate:
      eventsWithSlots > 0
        ? Math.round(totalFillRateSum / eventsWithSlots)
        : 0,
    eventsWithRosterGaps: eventsWithGaps,
  };
}
