import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Privacy filter condition for show_activity preference. */
const PRIVACY_FILTER = sql`(${schema.userPreferences.value} IS NULL OR ${schema.userPreferences.value}::text != 'false')`;

/** Select columns for top players query. */
const TOP_PLAYER_COLUMNS = {
  userId: schema.gameActivityRollups.userId,
  username: schema.users.username,
  avatar: schema.users.avatar,
  customAvatarUrl: schema.users.customAvatarUrl,
  discordId: schema.users.discordId,
  totalSeconds: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})::int`,
};

/**
 * Query top players for a game with privacy filtering.
 * @param db - Database connection
 * @param baseConditions - Period/game filter conditions
 * @returns Top 10 players by total seconds
 */
export async function queryTopPlayers(
  db: PostgresJsDatabase<typeof schema>,
  baseConditions: ReturnType<typeof eq>[],
) {
  return db
    .select(TOP_PLAYER_COLUMNS)
    .from(schema.gameActivityRollups)
    .innerJoin(
      schema.users,
      eq(schema.gameActivityRollups.userId, schema.users.id),
    )
    .leftJoin(
      schema.userPreferences,
      and(
        eq(schema.userPreferences.userId, schema.gameActivityRollups.userId),
        eq(schema.userPreferences.key, 'show_activity'),
      ),
    )
    .where(and(...baseConditions, PRIVACY_FILTER))
    .groupBy(
      schema.gameActivityRollups.userId,
      schema.users.username,
      schema.users.avatar,
      schema.users.customAvatarUrl,
      schema.users.discordId,
    )
    .orderBy(desc(sql`sum(${schema.gameActivityRollups.totalSeconds})`))
    .limit(10);
}

/**
 * Query total community seconds with privacy filtering.
 * @param db - Database connection
 * @param baseConditions - Period/game filter conditions
 * @returns Total seconds played
 */
export async function queryTotalSeconds(
  db: PostgresJsDatabase<typeof schema>,
  baseConditions: ReturnType<typeof eq>[],
): Promise<number> {
  const [totalResult] = await db
    .select({
      totalSeconds: sql<number>`coalesce(sum(${schema.gameActivityRollups.totalSeconds})::int, 0)`,
    })
    .from(schema.gameActivityRollups)
    .leftJoin(
      schema.userPreferences,
      and(
        eq(schema.userPreferences.userId, schema.gameActivityRollups.userId),
        eq(schema.userPreferences.key, 'show_activity'),
      ),
    )
    .where(and(...baseConditions, PRIVACY_FILTER));
  return totalResult?.totalSeconds ?? 0;
}

/** Select columns for now-playing query. */
const NOW_PLAYING_COLUMNS = {
  userId: schema.gameActivitySessions.userId,
  username: schema.users.username,
  avatar: schema.users.avatar,
  customAvatarUrl: schema.users.customAvatarUrl,
  discordId: schema.users.discordId,
};

/**
 * Query users currently playing a game (open sessions).
 * Respects show_activity privacy preference.
 * @param db - Database connection
 * @param gameId - Game ID to query
 * @returns Now-playing response DTO
 */
export async function queryNowPlaying(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
) {
  const players = await db
    .select(NOW_PLAYING_COLUMNS)
    .from(schema.gameActivitySessions)
    .innerJoin(
      schema.users,
      eq(schema.gameActivitySessions.userId, schema.users.id),
    )
    .leftJoin(
      schema.userPreferences,
      and(
        eq(schema.userPreferences.userId, schema.gameActivitySessions.userId),
        eq(schema.userPreferences.key, 'show_activity'),
      ),
    )
    .where(
      and(
        eq(schema.gameActivitySessions.gameId, gameId),
        isNull(schema.gameActivitySessions.endedAt),
        PRIVACY_FILTER,
      ),
    );

  return {
    players: players.map((p) => ({ ...p })),
    count: players.length,
  };
}

/**
 * Build activity period filter conditions.
 * @param gameId - Game ID
 * @param period - Activity period (week, month, all)
 * @returns Array of Drizzle filter conditions
 */
export function buildActivityConditions(
  gameId: number,
  period: 'week' | 'month' | 'all',
): ReturnType<typeof eq>[] {
  const conditions: ReturnType<typeof eq>[] = [
    eq(schema.gameActivityRollups.gameId, gameId),
  ];
  if (period === 'all') return conditions;

  const periodFilter = period === 'week' ? 'week' : 'month';
  conditions.push(eq(schema.gameActivityRollups.period, periodFilter));
  const truncFn = period === 'week' ? 'week' : 'month';
  conditions.push(
    sql`${schema.gameActivityRollups.periodStart} >= date_trunc(${truncFn}, now())::date`,
  );
  return conditions;
}
