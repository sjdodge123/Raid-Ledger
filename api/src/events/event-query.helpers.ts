/**
 * Query-building helpers for event listing and filtering.
 */
import { eq, gte, asc, desc, sql, and, inArray, ne } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  EventListQueryDto,
  EventListResponseDto,
  EventResponseDto,
  UserEventSignupsResponseDto,
} from '@raid-ledger/contract';
import { getSignupsPreviewForEvents } from './event-response.helpers';
import { buildFilterConditions } from './event-query-filters.helpers';

const EVENTS_CONFIG = { DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 } as const;

/** Shared type for event row with joined data. */
type EventRow = {
  events: typeof schema.events.$inferSelect;
  users: typeof schema.users.$inferSelect | null;
  games: typeof schema.games.$inferSelect | null;
  signupCount: number;
};

/** Shared type for signup preview entries. */
type SignupPreview = {
  id: number;
  discordId: string;
  username: string;
  avatar: string | null;
  customAvatarUrl?: string | null;
  characters?: { gameId: number; avatarUrl: string | null }[];
};

/** Builds the signup count subquery used by multiple query functions. */
function buildSignupCountSubquery(db: PostgresJsDatabase<typeof schema>) {
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

/** Counts events matching the given where condition. */
async function countEvents(
  db: PostgresJsDatabase<typeof schema>,
  whereCondition: ReturnType<typeof and>,
): Promise<number> {
  const countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.events);
  const countResult = whereCondition
    ? await countQuery.where(whereCondition)
    : await countQuery;
  return Number(countResult[0].count);
}

/** Fetches events with joins, applying optional where/sort/limit/offset. */
async function fetchEventsWithJoins(
  db: PostgresJsDatabase<typeof schema>,
  whereCondition: ReturnType<typeof and>,
  sortDir: typeof asc | typeof desc,
  limit: number,
  offset: number,
): Promise<EventRow[]> {
  const sq = buildSignupCountSubquery(db);
  let q = db
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
    .$dynamic();
  if (whereCondition) q = q.where(whereCondition);
  return q
    .orderBy(sortDir(sql`lower(${schema.events.duration})`))
    .limit(limit)
    .offset(offset);
}

/** Loads signups preview map if requested. */
async function loadSignupsPreview(
  db: PostgresJsDatabase<typeof schema>,
  events: EventRow[],
  includeSignups: string | undefined,
): Promise<Map<number, SignupPreview[]>> {
  if (includeSignups !== 'true' || events.length === 0) return new Map();
  return getSignupsPreviewForEvents(
    db,
    events.map((e) => e.events.id),
    5,
  );
}

/** Computes pagination parameters from query. */
function computePagination(query: EventListQueryDto): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = query.page ?? 1;
  const limit = Math.min(
    query.limit ?? EVENTS_CONFIG.DEFAULT_PAGE_SIZE,
    EVENTS_CONFIG.MAX_PAGE_SIZE,
  );
  return { page, limit, offset: (page - 1) * limit };
}

/** Builds the paginated response metadata. */
function buildMeta(
  total: number,
  page: number,
  limit: number,
): EventListResponseDto['meta'] {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  };
}

/** Fetches events and optional signups preview for a list query. */
async function fetchEventListData(
  db: PostgresJsDatabase<typeof schema>,
  query: EventListQueryDto,
  authenticatedUserId: number | undefined,
  pagination: { limit: number; offset: number },
): Promise<{
  events: EventRow[];
  total: number;
  signupsPreviewMap: Map<number, SignupPreview[]>;
}> {
  const conditions = buildFilterConditions(query, authenticatedUserId);
  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;
  const total = await countEvents(db, whereCondition);
  const sortDirection = query.upcoming === 'false' ? desc : asc;
  const events = await fetchEventsWithJoins(
    db,
    whereCondition,
    sortDirection,
    pagination.limit,
    pagination.offset,
  );
  const signupsPreviewMap = await loadSignupsPreview(
    db,
    events,
    query.includeSignups,
  );
  return { events, total, signupsPreviewMap };
}

/** Queries a paginated, filtered list of events. */
export async function queryEventList(
  db: PostgresJsDatabase<typeof schema>,
  query: EventListQueryDto,
  authenticatedUserId: number | undefined,
  mapToResponse: (
    row: EventRow,
    signupsPreview?: SignupPreview[],
  ) => EventResponseDto,
): Promise<EventListResponseDto> {
  const { page, limit, offset } = computePagination(query);
  const { events, total, signupsPreviewMap } = await fetchEventListData(
    db,
    query,
    authenticatedUserId,
    { limit, offset },
  );
  const data = events.map((row) =>
    mapToResponse(row, signupsPreviewMap.get(row.events.id)),
  );
  return { data, meta: buildMeta(total, page, limit) };
}

/** Builds conditions for upcoming user events query. */
function buildUpcomingUserConditions(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  now: string,
) {
  const signedUpEventIds = db
    .select({ eventId: schema.eventSignups.eventId })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.userId, userId),
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'departed'),
      ),
    );
  return [
    inArray(schema.events.id, signedUpEventIds),
    gte(sql`lower(${schema.events.duration})`, sql`${now}::timestamp`),
    sql`${schema.events.cancelledAt} IS NULL`,
  ];
}

/** Queries upcoming events a user is signed up for. */
export async function queryUpcomingByUser(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  limit: number,
  mapToResponse: (row: EventRow) => EventResponseDto,
): Promise<UserEventSignupsResponseDto> {
  const now = new Date().toISOString();
  const conditions = buildUpcomingUserConditions(db, userId, now);
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.events)
    .where(and(...conditions));
  const total = Number(countResult[0].count);
  const sq = buildSignupCountSubquery(db);
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
    .orderBy(asc(sql`lower(${schema.events.duration})`))
    .limit(limit);
  return { data: events.map((row) => mapToResponse(row)), total };
}
