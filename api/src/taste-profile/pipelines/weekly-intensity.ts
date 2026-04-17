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

interface CommunityDists {
  week: Map<number, number>;
  last4w: Map<number, number>;
  allTime: Map<number, number>;
  maxUniqueGames: number;
}

/** Rolling 4-week window start (28 days ago, floor to midnight). */
function fourWeekStart(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - 28);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Fetch the week's per-user rollup totals AND the max unique-games count
 * in a single pass over the current-week rollup slice. Saves one full
 * table scan vs. separating the two queries.
 */
async function loadCurrentWeekStats(
  db: Db,
  weekStart: Date,
): Promise<{ totals: Map<number, number>; maxUniqueGames: number }> {
  const rows = await db
    .select({
      userId: schema.gameActivityRollups.userId,
      totalSeconds: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})`,
      uniqueGames: sql<number>`count(distinct ${schema.gameActivityRollups.gameId})`,
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

  const totals = new Map<number, number>();
  let maxUniqueGames = 0;
  for (const r of rows) {
    totals.set(r.userId, Number(r.totalSeconds) / 3600);
    const unique = Number(r.uniqueGames);
    if (unique > maxUniqueGames) maxUniqueGames = unique;
  }
  return { totals, maxUniqueGames };
}

type RawTotalsRow = {
  user_id: number;
  total: number;
} & Record<string, unknown>;

function totalsMap(rows: RawTotalsRow[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.user_id, Number(r.total) / 3600);
  return map;
}

async function communityDistributions(
  db: Db,
  weekStart: Date,
  fourWkStart: Date,
): Promise<CommunityDists> {
  const currentWeek = await loadCurrentWeekStats(db, weekStart);

  const last4wRows = await db.execute<RawTotalsRow>(sql`
    SELECT user_id, SUM(total_seconds)::bigint AS total
    FROM ${schema.gameActivityRollups}
    WHERE period = 'day'
      AND period_start >= ${fourWkStart.toISOString().slice(0, 10)}
    GROUP BY user_id
  `);

  const allTimeRows = await db.execute<RawTotalsRow>(sql`
    SELECT user_id, SUM(total_seconds)::bigint AS total
    FROM ${schema.gameActivityRollups}
    WHERE period = 'day'
    GROUP BY user_id
  `);

  return {
    week: currentWeek.totals,
    last4w: totalsMap(last4wRows as unknown as RawTotalsRow[]),
    allTime: totalsMap(allTimeRows as unknown as RawTotalsRow[]),
    maxUniqueGames: currentWeek.maxUniqueGames,
  };
}

export async function runWeeklyIntensityRollup(db: Db): Promise<void> {
  const weekStart = currentWeekStart();
  const fourWkStart = fourWeekStart(new Date());
  const users = await db.select({ id: schema.users.id }).from(schema.users);

  const dists = await communityDistributions(db, weekStart, fourWkStart);
  const community: CommunityStats = {
    totalHoursDistribution: [...dists.week.values()],
    last4wHoursDistribution: [...dists.last4w.values()],
    allTimeHoursDistribution: [...dists.allTime.values()],
    maxUniqueGames: dists.maxUniqueGames,
  };

  for (const { id: userId } of users) {
    const snap = await buildWeeklySnapshot(db, userId, weekStart, dists);
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

async function buildWeeklySnapshot(
  db: Db,
  userId: number,
  weekStart: Date,
  dists: CommunityDists,
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

  const totalHours = rollups.reduce((acc, r) => acc + r.totalSeconds / 3600, 0);
  const gameBreakdown = rollups.map((r) => ({
    gameId: r.gameId,
    hours: Number((r.totalSeconds / 3600).toFixed(2)),
    source: 'presence',
  }));
  const longest = rollups.length
    ? rollups.reduce((a, b) => (b.totalSeconds > a.totalSeconds ? b : a))
    : null;
  const longestSessionHours = longest
    ? Number((longest.totalSeconds / 3600).toFixed(2))
    : 0;

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

  const last4wHours = dists.last4w.get(userId) ?? 0;
  const allTimeHours = dists.allTime.get(userId) ?? 0;

  // Skip users with zero signal across all three tiers — nothing to rank.
  if (
    totalHours === 0 &&
    last4wHours === 0 &&
    allTimeHours === 0 &&
    rollups.length === 0
  ) {
    return null;
  }

  return {
    input: {
      totalHours: Number(totalHours.toFixed(2)),
      last4wHours: Number(last4wHours.toFixed(2)),
      allTimeHours: Number(allTimeHours.toFixed(2)),
      longestSessionHours,
      uniqueGames: rollups.length,
      weeklyHistory,
    },
    gameBreakdown,
    longestGameId: longest?.gameId ?? null,
  };
}
