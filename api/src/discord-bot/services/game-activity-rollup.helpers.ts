import { and, isNotNull, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type { Logger } from '@nestjs/common';

/** Rollup buckets maintained by the daily cron. */
const PERIODS = ['day', 'week', 'month'] as const;

type Period = (typeof PERIODS)[number];

/** How far back to look for sessions that dirty a rollup bucket. */
const LOOKBACK_HOURS = 48;

/**
 * Aggregate closed sessions into day/week/month rollup rows.
 *
 * The lookback window only decides WHICH buckets are dirty; each dirty bucket
 * is then recomputed from every session it contains (ROK-1465). Recomputing
 * the whole bucket is what makes the write idempotent — the previous
 * implementation summed just the lookback window and hard-`SET` that total, so
 * any bucket wider than the window (`week`, `month`) silently dropped every
 * contribution that had closed before it. A month row written on the 20th kept
 * only the 19th–20th.
 *
 * Bucket boundaries are derived with `date_trunc` on the DB side so they match
 * the read path (`buildActivityConditions` in `igdb-activity.helpers.ts`)
 * exactly, instead of the Node process's local calendar.
 *
 * @param onGamesChanged - ROK-1082: fired once with the unique gameIds touched
 *                        by this rollup so the caller can enqueue one
 *                        taste-vector recompute per game (not per rollup row).
 * @param since - Overrides the lookback cutoff. Tests only; production uses
 *                the {@link LOOKBACK_HOURS} default.
 */
export async function aggregateRollups(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  onGamesChanged?: (gameIds: number[]) => void,
  since: Date = lookbackStart(),
): Promise<void> {
  const gameIds = await fetchDirtyGameIds(db, since);
  if (gameIds.length === 0) return;

  let rowCount = 0;
  for (const period of PERIODS) {
    rowCount += await recomputePeriod(db, period, since);
  }

  logger.log(
    `Recomputed ${rowCount} rollup row(s) across ${gameIds.length} game(s)`,
  );

  if (onGamesChanged) onGamesChanged(gameIds);
}

/** Start of the window used to detect buckets needing a recompute. */
function lookbackStart(): Date {
  const since = new Date();
  since.setHours(since.getHours() - LOOKBACK_HOURS);
  return since;
}

/** Only closed, game-matched, timed sessions ever feed a rollup. */
function countableSession(since?: Date) {
  return and(
    isNotNull(tables.gameActivitySessions.endedAt),
    isNotNull(tables.gameActivitySessions.gameId),
    isNotNull(tables.gameActivitySessions.durationSeconds),
    ...(since ? [gte(tables.gameActivitySessions.endedAt, since)] : []),
  );
}

/** Games with a session closed inside the lookback window. */
async function fetchDirtyGameIds(
  db: PostgresJsDatabase<typeof schema>,
  since: Date,
): Promise<number[]> {
  const rows = await db
    .selectDistinct({ gameId: tables.gameActivitySessions.gameId })
    .from(tables.gameActivitySessions)
    .where(countableSession(since));

  return rows
    .map((r) => r.gameId)
    .filter((id): id is number => typeof id === 'number');
}

/**
 * Recompute every `period` bucket touched by a session closed since `since`.
 *
 * The CTE names the dirty buckets; the INSERT then re-sums each one from the
 * full session history, so the hard `SET` on conflict is a true recompute and
 * re-running the cron never double-counts.
 */
/**
 * `since` is stringified because raw `sql` params bypass the Drizzle column
 * codec that would otherwise serialize a Date. `started_at`/`ended_at` are
 * `timestamp without time zone` holding UTC wall-clock (Drizzle writes
 * `toISOString()`), so an ISO string compares against them directly.
 */
async function recomputePeriod(
  db: PostgresJsDatabase<typeof schema>,
  period: Period,
  since: Date,
): Promise<number> {
  const bucket = sql`date_trunc(${period}::text, s.started_at)::date`;
  const countable = sql`s.ended_at IS NOT NULL
      AND s.game_id IS NOT NULL
      AND s.duration_seconds IS NOT NULL`;

  const rows = await db.execute(sql`
    WITH dirty AS (
      SELECT DISTINCT s.user_id, s.game_id, ${bucket} AS period_start
      FROM game_activity_sessions s
      WHERE ${countable} AND s.ended_at >= ${since.toISOString()}
    )
    INSERT INTO game_activity_rollups
      (user_id, game_id, period, period_start, total_seconds)
    SELECT s.user_id, s.game_id, ${period}::varchar, d.period_start,
           SUM(s.duration_seconds)::int
    FROM game_activity_sessions s
    JOIN dirty d
      ON d.user_id = s.user_id
     AND d.game_id = s.game_id
     AND d.period_start = ${bucket}
    WHERE ${countable}
    GROUP BY s.user_id, s.game_id, d.period_start
    ON CONFLICT (user_id, game_id, period, period_start)
    DO UPDATE SET total_seconds = EXCLUDED.total_seconds
    RETURNING user_id
  `);

  return rows.length;
}
