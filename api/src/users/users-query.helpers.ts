/**
 * Query helpers for UsersService.
 * Extracted from users.service.ts for file size compliance (ROK-711).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql, asc, and, gte, desc } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  ActivityPeriod,
  GameActivityEntryDto,
} from '@raid-ledger/contract';
import { buildWordMatchFilters } from '../common/search.util';

/** Basic user columns selected for list endpoints. */
const USER_LIST_COLUMNS = {
  id: schema.users.id,
  username: schema.users.username,
  avatar: schema.users.avatar,
  discordId: schema.users.discordId,
  customAvatarUrl: schema.users.customAvatarUrl,
} as const;

/** Build search conditions from a search string. */
function buildSearchCondition(search?: string) {
  const filters = search
    ? buildWordMatchFilters(schema.users.username, search)
    : [];
  return filters.length > 0 ? and(...filters) : undefined;
}

/** User list result type. */
type UserListResult = {
  data: Array<{
    id: number;
    username: string;
    avatar: string | null;
    discordId: string | null;
    customAvatarUrl: string | null;
  }>;
  total: number;
};

/** Find all users filtered by gameId (users who hearted the game). */
export async function findAllByGame(
  db: PostgresJsDatabase<typeof schema>,
  page: number,
  limit: number,
  search: string | undefined,
  gameId: number,
): Promise<UserListResult> {
  const offset = (page - 1) * limit;
  const searchCondition = buildSearchCondition(search);
  const whereClause = searchCondition
    ? and(eq(schema.gameInterests.gameId, gameId), searchCondition)
    : eq(schema.gameInterests.gameId, gameId);
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.gameInterests)
    .innerJoin(schema.users, eq(schema.gameInterests.userId, schema.users.id))
    .where(whereClause);
  const rows = await db
    .select(USER_LIST_COLUMNS)
    .from(schema.gameInterests)
    .innerJoin(schema.users, eq(schema.gameInterests.userId, schema.users.id))
    .where(whereClause)
    .orderBy(asc(schema.users.username))
    .limit(limit)
    .offset(offset);
  return { data: rows, total: Number(countResult.count) };
}

/** Find all users (no game filter). */
export async function findAllUsers(
  db: PostgresJsDatabase<typeof schema>,
  page: number,
  limit: number,
  search?: string,
): Promise<{
  data: Array<{
    id: number;
    username: string;
    avatar: string | null;
    discordId: string | null;
    customAvatarUrl: string | null;
  }>;
  total: number;
}> {
  const offset = (page - 1) * limit;
  const conditions = buildSearchCondition(search);
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.users)
    .where(conditions);
  const rows = await db
    .select(USER_LIST_COLUMNS)
    .from(schema.users)
    .where(conditions)
    .orderBy(asc(schema.users.username))
    .limit(limit)
    .offset(offset);
  return { data: rows, total: Number(countResult.count) };
}

/** Find all users with role information for admin panel. */
export async function findAllWithRolesQuery(
  db: PostgresJsDatabase<typeof schema>,
  page: number,
  limit: number,
  search?: string,
) {
  const offset = (page - 1) * limit;
  const conditions = buildSearchCondition(search);
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.users)
    .where(conditions);
  const rows = await db
    .select({
      ...USER_LIST_COLUMNS,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(conditions)
    .orderBy(asc(schema.users.username))
    .limit(limit)
    .offset(offset);
  return { data: rows, total: Number(countResult.count) };
}

/** Activity query select columns. */
const ACTIVITY_COLUMNS = {
  gameId: schema.gameActivityRollups.gameId,
  gameName: schema.games.name,
  coverUrl: schema.games.coverUrl,
  totalSeconds: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})::int`,
} as const;

/** Activity query group-by columns. */
const ACTIVITY_GROUP_BY = [
  schema.gameActivityRollups.gameId,
  schema.games.name,
  schema.games.coverUrl,
] as const;

/** Query game activity for a specific period. */
async function queryActivityForPeriod(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  period: 'week' | 'month',
) {
  const truncFn = period === 'week' ? 'week' : 'month';
  return db
    .select(ACTIVITY_COLUMNS)
    .from(schema.gameActivityRollups)
    .innerJoin(
      schema.games,
      eq(schema.gameActivityRollups.gameId, schema.games.id),
    )
    .where(
      and(
        eq(schema.gameActivityRollups.userId, userId),
        eq(schema.gameActivityRollups.period, period),
        gte(
          schema.gameActivityRollups.periodStart,
          sql`date_trunc(${truncFn}, now())::date`,
        ),
      ),
    )
    .groupBy(...ACTIVITY_GROUP_BY)
    .orderBy(desc(sql`sum(${schema.gameActivityRollups.totalSeconds})`))
    .limit(20);
}

/** Query game activity for all time. */
async function queryActivityAllTime(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
) {
  return db
    .select(ACTIVITY_COLUMNS)
    .from(schema.gameActivityRollups)
    .innerJoin(
      schema.games,
      eq(schema.gameActivityRollups.gameId, schema.games.id),
    )
    .where(eq(schema.gameActivityRollups.userId, userId))
    .groupBy(...ACTIVITY_GROUP_BY)
    .orderBy(desc(sql`sum(${schema.gameActivityRollups.totalSeconds})`))
    .limit(20);
}

/** Fetch game activity entries for a user. */
export async function fetchGameActivity(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  period: ActivityPeriod,
  requesterId?: number,
): Promise<GameActivityEntryDto[]> {
  if (requesterId !== userId) {
    const pref = await db.query.userPreferences.findFirst({
      where: and(
        eq(schema.userPreferences.userId, userId),
        eq(schema.userPreferences.key, 'show_activity'),
      ),
    });
    if (pref && pref.value === false) return [];
  }

  const rows =
    period === 'all'
      ? await queryActivityAllTime(db, userId)
      : await queryActivityForPeriod(db, userId, period);

  return rows.map((row, idx) => ({
    gameId: row.gameId,
    gameName: row.gameName,
    coverUrl: row.coverUrl,
    totalSeconds: row.totalSeconds,
    isMostPlayed: idx === 0,
  }));
}

/** Delete a user and cascade all related data in a transaction. */
export async function deleteUserTransaction(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  reassignToUserId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await tx
      .delete(schema.localCredentials)
      .where(eq(schema.localCredentials.userId, userId));
    await tx
      .delete(schema.availability)
      .where(eq(schema.availability.userId, userId));
    await tx
      .delete(schema.eventTemplates)
      .where(eq(schema.eventTemplates.userId, userId));
    await tx
      .update(schema.pugSlots)
      .set({ claimedByUserId: null })
      .where(eq(schema.pugSlots.claimedByUserId, userId));
    await tx
      .update(schema.pugSlots)
      .set({ createdBy: reassignToUserId })
      .where(eq(schema.pugSlots.createdBy, userId));
    await tx
      .update(schema.events)
      .set({ creatorId: reassignToUserId, updatedAt: new Date() })
      .where(eq(schema.events.creatorId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}
