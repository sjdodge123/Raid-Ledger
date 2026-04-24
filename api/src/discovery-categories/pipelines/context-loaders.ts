import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { elementwiseMean } from '../../game-taste/queries/similarity-queries';
import type {
  ExistingCategorySummary,
  TopPlayedGame,
  TrendingGame,
  CategoryTypeHint,
} from '../prompt-builder.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Max age (days) for a player vector to count toward the community centroid. */
const ACTIVE_PLAYER_RECENCY_DAYS = 30;

/**
 * Element-wise mean of player taste vectors for users whose vector has been
 * refreshed within the activity window. Returns null when no eligible
 * players exist so the generator degenerates to pure-theme candidates.
 */
export async function loadCommunityCentroid(db: Db): Promise<number[] | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ACTIVE_PLAYER_RECENCY_DAYS);
  const rows = await db
    .select({ vector: schema.playerTasteVectors.vector })
    .from(schema.playerTasteVectors)
    .where(gte(schema.playerTasteVectors.computedAt, cutoff));
  if (rows.length === 0) return null;
  return elementwiseMean(rows.map((r) => r.vector));
}

/**
 * Top N games by total logged playtime in the monthly rollup bucket whose
 * `period_start` is the most recent month boundary present in the table.
 */
export async function loadTopPlayedLastMonth(
  db: Db,
  n: number,
): Promise<TopPlayedGame[]> {
  const [latest] = await db
    .select({ periodStart: schema.gameActivityRollups.periodStart })
    .from(schema.gameActivityRollups)
    .where(eq(schema.gameActivityRollups.period, 'month'))
    .orderBy(desc(schema.gameActivityRollups.periodStart))
    .limit(1);
  if (!latest) return [];
  const rows = await db
    .select({
      name: schema.games.name,
      playerCount: schema.games.playerCount,
      totalSeconds: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})::int`,
    })
    .from(schema.gameActivityRollups)
    .innerJoin(
      schema.games,
      eq(schema.games.id, schema.gameActivityRollups.gameId),
    )
    .where(
      and(
        eq(schema.gameActivityRollups.period, 'month'),
        eq(schema.gameActivityRollups.periodStart, latest.periodStart),
      ),
    )
    .groupBy(schema.games.name, schema.games.playerCount)
    .orderBy(desc(sql`sum(${schema.gameActivityRollups.totalSeconds})`))
    .limit(n);
  return rows.map((r) => ({
    name: r.name,
    totalSeconds: Number(r.totalSeconds ?? 0),
    playerCount: r.playerCount ?? null,
  }));
}

/**
 * Week-over-week trending deltas: compare the most recent weekly rollup
 * against the prior week and report percentage change per game. Empty when
 * fewer than two weekly buckets exist.
 */
export async function loadTrending(db: Db, n: number): Promise<TrendingGame[]> {
  const weeks = await db
    .selectDistinct({ periodStart: schema.gameActivityRollups.periodStart })
    .from(schema.gameActivityRollups)
    .where(eq(schema.gameActivityRollups.period, 'week'))
    .orderBy(desc(schema.gameActivityRollups.periodStart))
    .limit(2);
  if (weeks.length < 2) return [];
  const [current, previous] = weeks;
  const rows = await db.execute<{
    name: string;
    player_count: { min: number; max: number } | null;
    curr: number;
    prev: number;
  }>(sql`
    SELECT g.name AS name,
           g.player_count AS player_count,
           COALESCE(curr.total, 0)::int AS curr,
           COALESCE(prev.total, 0)::int AS prev
    FROM games g
    LEFT JOIN (
      SELECT game_id, SUM(total_seconds) AS total
      FROM game_activity_rollups
      WHERE period = 'week' AND period_start = ${current.periodStart}
      GROUP BY game_id
    ) curr ON curr.game_id = g.id
    LEFT JOIN (
      SELECT game_id, SUM(total_seconds) AS total
      FROM game_activity_rollups
      WHERE period = 'week' AND period_start = ${previous.periodStart}
      GROUP BY game_id
    ) prev ON prev.game_id = g.id
    WHERE COALESCE(curr.total, 0) > 0 OR COALESCE(prev.total, 0) > 0
  `);
  return rows
    .map((r) => {
      const prev = Number(r.prev) || 0;
      const curr = Number(r.curr) || 0;
      const deltaPct =
        prev === 0
          ? curr > 0
            ? 999
            : 0
          : Math.round(((curr - prev) / prev) * 100);
      return { name: r.name, deltaPct, playerCount: r.player_count ?? null };
    })
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, n);
}

/**
 * Existing categories the LLM must not duplicate by name. Includes both
 * `pending` and `approved` so repeat regenerations don't produce near-duplicate
 * themes while earlier proposals are still sitting in the review queue.
 */
export async function loadExistingApprovedCategories(
  db: Db,
): Promise<ExistingCategorySummary[]> {
  const rows = await db
    .select({
      name: schema.discoveryCategorySuggestions.name,
      categoryType: schema.discoveryCategorySuggestions.categoryType,
    })
    .from(schema.discoveryCategorySuggestions)
    .where(
      inArray(schema.discoveryCategorySuggestions.status, [
        'pending',
        'approved',
      ]),
    );
  return rows.map((r) => ({
    name: r.name,
    categoryType: r.categoryType as CategoryTypeHint,
  }));
}
