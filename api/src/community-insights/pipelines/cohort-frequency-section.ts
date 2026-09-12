/**
 * Cohort game-frequency aggregation (ROK-1310).
 *
 * Reads `community_lineup_cohort_memory` LIVE — this section is deliberately
 * NOT part of the daily snapshot pipeline, so an empty table is an empty
 * payload rather than `503 no_snapshot_yet`.
 *
 * SQL groups by `(cohort_size, game_id)` exactly as the AC specifies; the
 * `6+` collapse, the top-N cut and the ranking happen in TypeScript so the
 * bucketing rule is unit-testable and lives in one place.
 *
 * ## `count` is OCCASIONS, not rows
 *
 * The AC's "match count" is how many times a group of this size landed on the
 * game, with the per-resolution split shown separately as the breakdown badge.
 * One real outcome writes several rows: a `voting -> decided` transition writes
 * `decided` AND `match` for the winner, and via a tiebreaker it also writes
 * `veto_won`. Summing the four resolution keys therefore scored a plainly
 * decided game 2 and a tiebreaker-decided game 3, systematically over-ranking
 * tiebreaker games. `count` is `COUNT(DISTINCT source_lineup_id)` — one lineup,
 * one occasion — while `breakdown` keeps the full per-resolution split.
 *
 * Sibling style: `churn-section.ts`.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  COHORT_SIZE_BUCKETS,
  type CohortFrequencyBucketDto,
  type CohortFrequencyEntryDto,
  type CohortGameFrequencyResponseDto,
  type CohortSizeBucket,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type CohortFrequencyMode = 'matched' | 'rejected';

export interface CohortFrequencyOptions {
  mode: CohortFrequencyMode;
  topN: number;
}

/**
 * Cohort size -> bucket label. Sizes 6 and up share `6+` (sparse-tail noise);
 * a size below 2 is not a cohort at all and gets no bucket.
 */
export function cohortSizeBucket(size: number): CohortSizeBucket | null {
  if (size >= 6) return '6+';
  if (size >= 2) return String(size) as CohortSizeBucket;
  return null;
}

interface FrequencyRow {
  cohortSize: number;
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
  /** Distinct source lineups behind this (size, game) pair — the headline count. */
  lineups: number;
  decided: number;
  match: number;
  vetoWon: number;
  vetoLost: number;
}

/** Mutable accumulator — one per (bucket, game). */
type Tally = Omit<CohortFrequencyEntryDto, 'rank'>;

async function loadFrequencyRows(
  db: Db,
  mode: CohortFrequencyMode,
): Promise<FrequencyRow[]> {
  const modeFilter =
    mode === 'rejected'
      ? sql`m.resolution = 'veto_lost'`
      : sql`m.resolution <> 'veto_lost'`;
  const rows = (await db.execute(sql`
    SELECT
      m.cohort_size AS "cohortSize",
      m.game_id AS "gameId",
      g.name AS "gameName",
      g.cover_url AS "gameCoverUrl",
      COUNT(DISTINCT m.source_lineup_id)::int AS "lineups",
      COUNT(*) FILTER (WHERE m.resolution = 'decided')::int AS "decided",
      COUNT(*) FILTER (WHERE m.resolution = 'match')::int AS "match",
      COUNT(*) FILTER (WHERE m.resolution = 'veto_won')::int AS "vetoWon",
      COUNT(*) FILTER (WHERE m.resolution = 'veto_lost')::int AS "vetoLost"
    FROM community_lineup_cohort_memory m
    JOIN games g ON g.id = m.game_id
    WHERE ${modeFilter}
    GROUP BY m.cohort_size, m.game_id, g.name, g.cover_url
  `)) as unknown as FrequencyRow[];
  return [...rows];
}

/** Fold one row into its bucket's per-game tally. */
function accumulate(
  byBucket: Map<CohortSizeBucket, Map<number, Tally>>,
  row: FrequencyRow,
): void {
  const bucket = cohortSizeBucket(Number(row.cohortSize));
  if (!bucket) return;
  const games = byBucket.get(bucket) ?? new Map<number, Tally>();
  byBucket.set(bucket, games);
  const tally = games.get(Number(row.gameId)) ?? {
    gameId: Number(row.gameId),
    gameName: row.gameName,
    gameCoverUrl: row.gameCoverUrl ?? null,
    count: 0,
    breakdown: { decided: 0, match: 0, vetoWon: 0, vetoLost: 0 },
  };
  for (const key of ['decided', 'match', 'vetoWon', 'vetoLost'] as const) {
    tally.breakdown[key] += Number(row[key]);
  }
  // One lineup = one occasion, however many resolution rows it wrote.
  tally.count += Number(row.lineups);
  games.set(tally.gameId, tally);
}

/** Highest count first; ties broken by name so the order is deterministic. */
function rankBucket(tallies: Tally[], topN: number): CohortFrequencyEntryDto[] {
  return [...tallies]
    .sort((a, b) => b.count - a.count || a.gameName.localeCompare(b.gameName))
    .slice(0, topN)
    .map((t, i) => ({ rank: i + 1, ...t }));
}

/**
 * Top-N games per cohort-size bucket for the requested mode. Buckets with no
 * entries are omitted; the remainder keep ascending cohort-size order.
 */
export async function buildCohortFrequencySection(
  db: Db,
  options: CohortFrequencyOptions,
): Promise<CohortGameFrequencyResponseDto> {
  const rows = await loadFrequencyRows(db, options.mode);
  const byBucket = new Map<CohortSizeBucket, Map<number, Tally>>();
  for (const row of rows) accumulate(byBucket, row);
  const buckets: CohortFrequencyBucketDto[] = [];
  for (const bucket of COHORT_SIZE_BUCKETS) {
    const games = byBucket.get(bucket);
    if (!games || games.size === 0) continue;
    buckets.push({
      bucket,
      entries: rankBucket([...games.values()], options.topN),
    });
  }
  return { mode: options.mode, topN: options.topN, buckets };
}
