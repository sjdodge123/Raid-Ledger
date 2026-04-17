import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  computeIntensityMetrics,
  type CommunityStats,
  type WeeklySnapshotInput,
} from '../intensity-rollup.helpers';

type Db = PostgresJsDatabase<typeof schema>;

interface WeeklySnapshot {
  input: WeeklySnapshotInput;
  gameBreakdown: Array<{ gameId: number; hours: number; source: string }>;
  longestGameId: number | null;
}

export async function runWeeklyIntensityRollup(db: Db): Promise<void> {
  const weekStart = currentWeekStart();
  const users = await db.select({ id: schema.users.id }).from(schema.users);

  const allWeekly = await db
    .select({
      userId: schema.gameActivityRollups.userId,
      total: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})`,
    })
    .from(schema.gameActivityRollups)
    .where(
      and(
        eq(schema.gameActivityRollups.period, 'week'),
        eq(
          schema.gameActivityRollups.periodStart,
          weekStart.toISOString().slice(0, 10),
        ),
      ),
    )
    .groupBy(schema.gameActivityRollups.userId);

  const community: CommunityStats = {
    totalHoursDistribution: allWeekly.map((r) => Number(r.total) / 3600),
    maxUniqueGames: await maxUniqueGamesThisWeek(db, weekStart),
  };

  for (const { id: userId } of users) {
    const snap = await buildWeeklySnapshot(db, userId, weekStart);
    if (!snap) continue;

    const metrics = computeIntensityMetrics(snap.input, community);

    await db
      .insert(schema.playerIntensitySnapshots)
      .values({
        userId,
        weekStart: weekStart.toISOString().slice(0, 10),
        totalHours: snap.input.totalHours.toFixed(2),
        gameBreakdown: snap.gameBreakdown,
        uniqueGames: snap.input.uniqueGames,
        longestSessionHours: snap.input.longestSessionHours.toFixed(2),
        longestSessionGameId: snap.longestGameId,
      })
      .onConflictDoUpdate({
        target: [
          schema.playerIntensitySnapshots.userId,
          schema.playerIntensitySnapshots.weekStart,
        ],
        set: {
          totalHours: snap.input.totalHours.toFixed(2),
          gameBreakdown: snap.gameBreakdown,
          uniqueGames: snap.input.uniqueGames,
          longestSessionHours: snap.input.longestSessionHours.toFixed(2),
          longestSessionGameId: snap.longestGameId,
        },
      });

    await db
      .update(schema.playerTasteVectors)
      .set({ intensityMetrics: metrics })
      .where(eq(schema.playerTasteVectors.userId, userId));
  }
}

/** Monday-start, local date — matches `game_activity_rollups` convention. */
export function currentWeekStart(): Date {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

async function maxUniqueGamesThisWeek(
  db: Db,
  weekStart: Date,
): Promise<number> {
  const rows = await db.execute<{ c: number }>(sql`
    SELECT MAX(c)::int AS c FROM (
      SELECT COUNT(DISTINCT game_id) AS c
      FROM game_activity_rollups
      WHERE period = 'week' AND period_start = ${weekStart.toISOString().slice(0, 10)}
      GROUP BY user_id
    ) t
  `);
  return Number(rows[0]?.c ?? 0);
}

async function buildWeeklySnapshot(
  db: Db,
  userId: number,
  weekStart: Date,
): Promise<WeeklySnapshot | null> {
  const rollups = await db
    .select()
    .from(schema.gameActivityRollups)
    .where(
      and(
        eq(schema.gameActivityRollups.userId, userId),
        eq(schema.gameActivityRollups.period, 'week'),
        eq(
          schema.gameActivityRollups.periodStart,
          weekStart.toISOString().slice(0, 10),
        ),
      ),
    );
  if (rollups.length === 0) return null;

  const totalHours = rollups.reduce((acc, r) => acc + r.totalSeconds / 3600, 0);
  const gameBreakdown = rollups.map((r) => ({
    gameId: r.gameId,
    hours: Number((r.totalSeconds / 3600).toFixed(2)),
    source: 'presence',
  }));
  const longest = rollups.reduce((a, b) =>
    b.totalSeconds > a.totalSeconds ? b : a,
  );
  const longestSessionHours = Number((longest.totalSeconds / 3600).toFixed(2));

  const historyRows = await db
    .select({
      total: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})`,
      periodStart: schema.gameActivityRollups.periodStart,
    })
    .from(schema.gameActivityRollups)
    .where(
      and(
        eq(schema.gameActivityRollups.userId, userId),
        eq(schema.gameActivityRollups.period, 'week'),
        sql`${schema.gameActivityRollups.periodStart} >= ${new Date(
          weekStart.getTime() - 8 * 7 * 24 * 3600 * 1000,
        )
          .toISOString()
          .slice(0, 10)}`,
      ),
    )
    .groupBy(schema.gameActivityRollups.periodStart)
    .orderBy(desc(schema.gameActivityRollups.periodStart));
  const weeklyHistory = historyRows.map((r) => Number(r.total) / 3600);

  return {
    input: {
      totalHours: Number(totalHours.toFixed(2)),
      longestSessionHours,
      uniqueGames: rollups.length,
      weeklyHistory,
    },
    gameBreakdown,
    longestGameId: longest.gameId,
  };
}
