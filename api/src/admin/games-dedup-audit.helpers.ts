/**
 * ROK-1271: read-only dedup audit for games rows.
 *
 * Helpers extracted from GamesDedupAuditService so the service file stays
 * within the 300-line ESLint cap. Pure logic (bucketing + canonical pick)
 * lives here alongside the per-id blast-radius query map.
 */
import { count, eq, sql } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { normalizeForDedup } from '../igdb/igdb-search-dedup.helpers';
import { buildExtraCountQueries } from './games-dedup-extra-counts.helpers';

/** Minimal game-row projection used by the audit pipeline. */
export interface GameRow {
  id: number;
  name: string;
  slug: string;
  igdbId: number | null;
  itadGameId: string | null;
  steamAppId: number | null;
  cachedAt: Date;
}

/**
 * Match key for a row in the precedence-based bucketing.
 *
 * NOTE (ROK-1277): the audit pipeline no longer uses precedence-key
 * bucketing for grouping — see `games-dedup-union-find.helpers.ts` for the
 * connected-components grouping that replaced it. `DedupKey` and
 * `bucketRowsByDedupKey` remain exported because they're still covered by
 * unit tests (they're a useful primitive for any future code paths that need
 * single-precedence bucketing).
 */
export type DedupKey = `igdb:${number}` | `steam:${number}` | `name:${string}`;

/**
 * Bucket rows by dedup key with precedence: igdb → steam → name.
 *
 * A row that has any of `igdbId`, `steamAppId`, or a non-empty normalized
 * name is placed in exactly one bucket — the first matching precedence
 * tier. Rows whose normalized name is empty (cannot happen for valid
 * seed data but guards against junk) are silently dropped.
 *
 * NOTE (ROK-1277): the audit pipeline (`GamesDedupAuditService.runAudit`)
 * now uses `groupRowsByConnectedKeys` from `games-dedup-union-find.helpers`
 * instead of this helper. This function is retained for unit coverage and
 * potential future single-precedence use cases.
 */
export function bucketRowsByDedupKey(
  rows: GameRow[],
): Map<DedupKey, GameRow[]> {
  const buckets = new Map<DedupKey, GameRow[]>();
  for (const row of rows) {
    const key = dedupKeyFor(row);
    if (!key) continue;
    const existing = buckets.get(key);
    if (existing) existing.push(row);
    else buckets.set(key, [row]);
  }
  return buckets;
}

function dedupKeyFor(row: GameRow): DedupKey | null {
  if (row.igdbId != null) return `igdb:${row.igdbId}`;
  if (row.steamAppId != null) return `steam:${row.steamAppId}`;
  const normName = normalizeForDedup(row.name);
  if (normName.length === 0) return null;
  return `name:${normName}`;
}

/**
 * Tiebreak the canonical id within a dup group:
 *   1. row with non-null `itadGameId` wins
 *   2. row with non-null `igdbId` wins
 *   3. lowest id wins
 */
export function pickCanonicalId(rows: GameRow[]): number {
  if (rows.length === 0) throw new Error('pickCanonicalId requires ≥1 row');
  const byItad = rows.filter((r) => r.itadGameId != null);
  if (byItad.length > 0) return Math.min(...byItad.map((r) => r.id));
  const byIgdb = rows.filter((r) => r.igdbId != null);
  if (byIgdb.length > 0) return Math.min(...byIgdb.map((r) => r.id));
  return Math.min(...rows.map((r) => r.id));
}

/** Per-game downstream-row counts across the 23 FK tables (17 + 6 from ROK-1270). */
export interface BlastRadiusCounts {
  events: number;
  eventPlans: number;
  lineupsDecided: number;
  lineupEntries: number;
  lineupMatches: number;
  lineupMatchMembers: number;
  tiebreakers: number;
  characters: number;
  tasteVectors: number;
  interests: number;
  activityRollups: number;
  activitySessions: number;
  availability: number;
  channelBindings: number;
  discordMappings: number;
  eventTypes: number;
  interestSuppressions: number;
  tiebreakerBracketGameA: number;
  tiebreakerBracketGameB: number;
  tiebreakerBracketWinner: number;
  tiebreakerBracketVotes: number;
  tiebreakerVetoes: number;
  playerIntensitySnapshots: number;
}

export interface BlastRadiusRow extends BlastRadiusCounts {
  gameId: number;
}

type Db = PostgresJsDatabase<typeof schema>;

function takeCount(rows: { c: number }[]): number {
  return Number(rows[0]?.c ?? 0);
}

/** Single-shape direct count: SELECT count(*) FROM table WHERE column = id. */
function countDirect(
  db: Db,
  table: PgTable,
  column: Column,
  id: number,
): Promise<number> {
  return db
    .select({ c: count() })
    .from(table)
    .where(eq(column, id))
    .then(takeCount);
}

/** 22 of the 23 FK tables (ROK-1271's 16 + ROK-1270's 6) expose a direct
 * `gameId` (or `decidedGameId` / `winnerGameId` / `gameAId` / `gameBId` /
 * `longestSessionGameId`) column — these all share a single SELECT shape.
 * The 23rd table (`community_lineup_match_members`) needs a JOIN, handled
 * separately by `countLineupMatchMembers`.
 *
 * The 16 ROK-1271 direct counts are emitted here; the 6 ROK-1270 direct
 * counts are spread in from `buildExtraCountQueries` (same lockstep order
 * contract — destructure below must match). */
function buildDirectCountQueries(db: Db, id: number): Promise<number>[] {
  return [
    countDirect(db, schema.events, schema.events.gameId, id),
    countDirect(db, schema.eventPlans, schema.eventPlans.gameId, id),
    countDirect(
      db,
      schema.communityLineups,
      schema.communityLineups.decidedGameId,
      id,
    ),
    countDirect(
      db,
      schema.communityLineupEntries,
      schema.communityLineupEntries.gameId,
      id,
    ),
    countDirect(
      db,
      schema.communityLineupMatches,
      schema.communityLineupMatches.gameId,
      id,
    ),
    countDirect(
      db,
      schema.communityLineupTiebreakers,
      schema.communityLineupTiebreakers.winnerGameId,
      id,
    ),
    countDirect(db, schema.characters, schema.characters.gameId, id),
    countDirect(
      db,
      schema.gameTasteVectors,
      schema.gameTasteVectors.gameId,
      id,
    ),
    countDirect(db, schema.gameInterests, schema.gameInterests.gameId, id),
    countDirect(
      db,
      schema.gameActivityRollups,
      schema.gameActivityRollups.gameId,
      id,
    ),
    countDirect(
      db,
      schema.gameActivitySessions,
      schema.gameActivitySessions.gameId,
      id,
    ),
    countDirect(db, schema.availability, schema.availability.gameId, id),
    countDirect(db, schema.channelBindings, schema.channelBindings.gameId, id),
    countDirect(
      db,
      schema.discordGameMappings,
      schema.discordGameMappings.gameId,
      id,
    ),
    countDirect(db, schema.eventTypes, schema.eventTypes.gameId, id),
    countDirect(
      db,
      schema.gameInterestSuppressions,
      schema.gameInterestSuppressions.gameId,
      id,
    ),
    ...buildExtraCountQueries(db, id),
  ];
}

async function countLineupMatchMembers(db: Db, id: number): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM community_lineup_match_members m
    JOIN community_lineup_matches lm ON m.match_id = lm.id
    WHERE lm.game_id = ${id}
  `)) as { c: number }[];
  return takeCount(rows);
}

/**
 * Compute the 17-table blast radius for a single game id.
 * All 17 queries run in parallel via Promise.all.
 *
 * Notes:
 * - `lineupMatchMembers` has no direct `gameId` FK — counted via JOIN through
 *   `communityLineupMatches.gameId`.
 * - `tiebreakers` is counted via `winnerGameId` only. The `tiedGameIds` JSONB
 *   column is NOT counted here; full tie-breaker merge logic lives in
 *   ROK-1270's commit phase, not this audit endpoint.
 *
 * The direct-count helpers are emitted in the order matching the
 * destructuring below; if you reorder them, update both lists together.
 */
export async function computeBlastRadiusForId(
  db: Db,
  id: number,
): Promise<BlastRadiusRow> {
  const [
    events,
    eventPlans,
    lineupsDecided,
    lineupEntries,
    lineupMatches,
    tiebreakers,
    characters,
    tasteVectors,
    interests,
    activityRollups,
    activitySessions,
    availability,
    channelBindings,
    discordMappings,
    eventTypes,
    interestSuppressions,
    tiebreakerBracketGameA,
    tiebreakerBracketGameB,
    tiebreakerBracketWinner,
    tiebreakerBracketVotes,
    tiebreakerVetoes,
    playerIntensitySnapshots,
    lineupMatchMembers,
  ] = await Promise.all([
    ...buildDirectCountQueries(db, id),
    countLineupMatchMembers(db, id),
  ]);
  return {
    gameId: id,
    events,
    eventPlans,
    lineupsDecided,
    lineupEntries,
    lineupMatches,
    lineupMatchMembers,
    tiebreakers,
    characters,
    tasteVectors,
    interests,
    activityRollups,
    activitySessions,
    availability,
    channelBindings,
    discordMappings,
    eventTypes,
    interestSuppressions,
    tiebreakerBracketGameA,
    tiebreakerBracketGameB,
    tiebreakerBracketWinner,
    tiebreakerBracketVotes,
    tiebreakerVetoes,
    playerIntensitySnapshots,
  };
}

/** Total downstream rows for a blast-radius row (used for sorting). */
export function totalBlastRadius(row: BlastRadiusCounts): number {
  return (
    row.events +
    row.eventPlans +
    row.lineupsDecided +
    row.lineupEntries +
    row.lineupMatches +
    row.lineupMatchMembers +
    row.tiebreakers +
    row.characters +
    row.tasteVectors +
    row.interests +
    row.activityRollups +
    row.activitySessions +
    row.availability +
    row.channelBindings +
    row.discordMappings +
    row.eventTypes +
    row.interestSuppressions +
    row.tiebreakerBracketGameA +
    row.tiebreakerBracketGameB +
    row.tiebreakerBracketWinner +
    row.tiebreakerBracketVotes +
    row.tiebreakerVetoes +
    row.playerIntensitySnapshots
  );
}
