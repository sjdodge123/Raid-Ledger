/**
 * ROK-1271: read-only dedup audit for games rows.
 *
 * Helpers extracted from GamesDedupAuditService so the service file stays
 * within the 300-line ESLint cap. Pure logic (bucketing + canonical pick)
 * lives here alongside the per-id blast-radius query map.
 */
import { count, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { normalizeForDedup } from '../igdb/igdb-search-dedup.helpers';

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

/** Match key for a row, indicates how the dup was detected. */
export type DedupKey = `igdb:${number}` | `steam:${number}` | `name:${string}`;

/**
 * Bucket rows by dedup key with precedence: igdb → steam → name.
 *
 * A row that has any of `igdbId`, `steamAppId`, or a non-empty normalized
 * name is placed in exactly one bucket — the first matching precedence
 * tier. Rows whose normalized name is empty (cannot happen for valid
 * seed data but guards against junk) are silently dropped.
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

/** Per-game downstream-row counts across the 17 FK tables. */
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
}

export interface BlastRadiusRow extends BlastRadiusCounts {
  gameId: number;
}

type Db = PostgresJsDatabase<typeof schema>;

function takeCount(rows: { c: number }[]): number {
  return Number(rows[0]?.c ?? 0);
}

/** 16 of the 17 FK tables expose a direct `gameId` (or `decidedGameId`/`winnerGameId`)
 * column — these all share a single SELECT shape. The 17th table
 * (`community_lineup_match_members`) needs a JOIN, handled separately. */
function buildDirectCountQueries(db: Db, id: number): Promise<number>[] {
  const c = () => count();
  return [
    db
      .select({ c: c() })
      .from(schema.events)
      .where(eq(schema.events.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.decidedGameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.communityLineupEntries)
      .where(eq(schema.communityLineupEntries.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.communityLineupTiebreakers)
      .where(eq(schema.communityLineupTiebreakers.winnerGameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.characters)
      .where(eq(schema.characters.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.gameTasteVectors)
      .where(eq(schema.gameTasteVectors.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.gameInterests)
      .where(eq(schema.gameInterests.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.gameActivityRollups)
      .where(eq(schema.gameActivityRollups.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.gameActivitySessions)
      .where(eq(schema.gameActivitySessions.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.availability)
      .where(eq(schema.availability.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.discordGameMappings)
      .where(eq(schema.discordGameMappings.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.eventTypes)
      .where(eq(schema.eventTypes.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.gameInterestSuppressions)
      .where(eq(schema.gameInterestSuppressions.gameId, id))
      .then(takeCount),
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
    row.interestSuppressions
  );
}
