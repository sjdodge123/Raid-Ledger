/**
 * ROK-1270: pre-merge UNIQUE-constraint conflict counts for a dup group.
 *
 * Inputs: canonical game id + the dup ids that would collapse into it.
 * Output: `Record<tableName, number>` — the number of dup-side rows that
 * would violate a UNIQUE(game_id, ...other) constraint if Phase 2's merge
 * re-pointed dup rows to the canonical id.
 *
 * 9 UNIQUE-constraint tables covered (re-grepped against schema/*.ts):
 *   - characters                       UNIQUE(user_id, game_id, name, realm)
 *   - community_lineup_entries         UNIQUE(lineup_id, game_id)
 *   - community_lineup_matches         UNIQUE(lineup_id, game_id)
 *   - community_lineup_votes           UNIQUE(lineup_id, user_id, game_id)
 *   - event_types                      UNIQUE(game_id, slug)
 *   - game_activity_rollups            UNIQUE(user_id, game_id, period, period_start)
 *   - game_interests                   UNIQUE(user_id, game_id, source)
 *   - game_interest_suppressions       UNIQUE(user_id, game_id)
 *   - game_taste_vectors               UNIQUE(game_id) — single-column
 *
 * All keys are emitted on every output (zero if no conflict) so downstream
 * consumers get a stable JSONB shape.
 *
 * Algorithm:
 *   - For composite UNIQUEs that include `game_id` + ≥1 other column: a
 *     conflict is a dup-side row whose "other columns" tuple matches some
 *     canonical-side row's tuple. We compute this via a JOIN to the
 *     canonical's row-set on the other columns.
 *   - For `game_taste_vectors` (single-column UNIQUE): a conflict is any
 *     dup-side row at all, IF the canonical also has a row. We emit
 *     `tasteVectors = 1` in that case (else 0).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

export interface UniqueConflictInput {
  canonicalId: number;
  dupIds: number[];
}

export type UniqueConflictCounts = {
  characters: number;
  lineupEntries: number;
  lineupMatches: number;
  lineupVotes: number;
  eventTypes: number;
  activityRollups: number;
  interests: number;
  interestSuppressions: number;
  tasteVectors: number;
};

const EMPTY: UniqueConflictCounts = {
  characters: 0,
  lineupEntries: 0,
  lineupMatches: 0,
  lineupVotes: 0,
  eventTypes: 0,
  activityRollups: 0,
  interests: 0,
  interestSuppressions: 0,
  tasteVectors: 0,
};

function takeInt(rows: { c: number }[]): number {
  return Number(rows[0]?.c ?? 0);
}

/**
 * SQL-injection guard for the sql.raw interpolations below: canonicalId and
 * every dupId MUST be integers before being stitched into raw SQL text.
 * All current callers pass typed games.id values; this makes the guarantee
 * explicit instead of relying on caller discipline.
 */
function assertIntegerIds(input: UniqueConflictInput): void {
  if (
    !Number.isInteger(input.canonicalId) ||
    !input.dupIds.every((id) => Number.isInteger(id))
  ) {
    throw new Error(
      'computeUniqueConflicts: canonicalId and all dupIds must be integers',
    );
  }
}

/**
 * Count dup-side rows that would collide with a canonical-side row on a
 * composite UNIQUE(game_id, ...otherCols). Uses an INNER JOIN where the
 * "other columns" must match between dup-side and canonical-side rows.
 *
 * `tableName` is interpolated via `sql.raw` — only ever called with
 * compile-time literals below, NEVER with user input. Numeric inputs are
 * asserted integer at the `computeUniqueConflicts` entry point.
 */
async function countCompositeConflicts(
  db: Db,
  tableName: string,
  otherCols: string[],
  input: UniqueConflictInput,
): Promise<number> {
  if (input.dupIds.length === 0) return 0;
  const joinCondition = otherCols
    .map((col) => `dup.${col} IS NOT DISTINCT FROM canon.${col}`)
    .join(' AND ');
  const query = sql.raw(`
    SELECT COUNT(*)::int AS c
    FROM ${tableName} dup
    JOIN ${tableName} canon
      ON ${joinCondition}
     AND canon.game_id = ${input.canonicalId}
    WHERE dup.game_id = ANY(ARRAY[${input.dupIds.join(',')}]::int[])
  `);
  const rows = (await db.execute(query)) as { c: number }[];
  return takeInt(rows);
}

/** Single-column UNIQUE(game_id) — emits 1 iff canonical has a row AND any dup does. */
async function countSingleColumnConflict(
  db: Db,
  tableName: string,
  input: UniqueConflictInput,
): Promise<number> {
  if (input.dupIds.length === 0) return 0;
  const query = sql.raw(`
    SELECT
      (
        EXISTS(SELECT 1 FROM ${tableName} WHERE game_id = ${input.canonicalId})
        AND EXISTS(SELECT 1 FROM ${tableName}
                   WHERE game_id = ANY(ARRAY[${input.dupIds.join(',')}]::int[]))
      )::int AS c
  `);
  const rows = (await db.execute(query)) as { c: number }[];
  return takeInt(rows);
}

export async function computeUniqueConflicts(
  db: Db,
  input: UniqueConflictInput,
): Promise<UniqueConflictCounts> {
  assertIntegerIds(input);
  if (input.dupIds.length === 0) return { ...EMPTY };

  const [
    characters,
    lineupEntries,
    lineupMatches,
    lineupVotes,
    eventTypes,
    activityRollups,
    interests,
    interestSuppressions,
    tasteVectors,
  ] = await Promise.all([
    countCompositeConflicts(
      db,
      'characters',
      ['user_id', 'name', 'realm'],
      input,
    ),
    countCompositeConflicts(
      db,
      'community_lineup_entries',
      ['lineup_id'],
      input,
    ),
    countCompositeConflicts(
      db,
      'community_lineup_matches',
      ['lineup_id'],
      input,
    ),
    countCompositeConflicts(
      db,
      'community_lineup_votes',
      ['lineup_id', 'user_id'],
      input,
    ),
    countCompositeConflicts(db, 'event_types', ['slug'], input),
    countCompositeConflicts(
      db,
      'game_activity_rollups',
      ['user_id', 'period', 'period_start'],
      input,
    ),
    countCompositeConflicts(db, 'game_interests', ['user_id', 'source'], input),
    countCompositeConflicts(
      db,
      'game_interest_suppressions',
      ['user_id'],
      input,
    ),
    countSingleColumnConflict(db, 'game_taste_vectors', input),
  ]);
  return {
    characters,
    lineupEntries,
    lineupMatches,
    lineupVotes,
    eventTypes,
    activityRollups,
    interests,
    interestSuppressions,
    tasteVectors,
  };
}
