/**
 * Rollup reads behind the user profile's Game Activity card.
 * Split out of `users-query.helpers.ts` (max-lines) for ROK-2262.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { ALL_TIME_ROLLUP_PERIOD } from '../igdb/igdb-activity.helpers';

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

/** Query a user's game activity for the current week or month. */
export async function queryActivityForPeriod(
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

/**
 * Query a user's all-time game activity, reading ONE rollup granularity so a
 * session is not counted once per day/week/month bucket (ROK-2262).
 */
export async function queryActivityAllTime(
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
    .where(
      and(
        eq(schema.gameActivityRollups.userId, userId),
        eq(schema.gameActivityRollups.period, ALL_TIME_ROLLUP_PERIOD),
      ),
    )
    .groupBy(...ACTIVITY_GROUP_BY)
    .orderBy(desc(sql`sum(${schema.gameActivityRollups.totalSeconds})`))
    .limit(20);
}
