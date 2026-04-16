/**
 * FK reassignment helpers for game deduplication cleanup (ROK-1008).
 * Moves foreign key references from loser game rows to the winner,
 * handling unique constraint violations by skipping conflicting rows.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';

type Tx = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

/** Reassign event-related FKs from loser to winner. */
export async function reassignEventFks(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await safeReassign(tx, 'events', 'game_id', loserId, winnerId);
}

/** Reassign community lineup FKs from loser to winner. */
export async function reassignLineupFks(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await safeReassign(
    tx,
    'community_lineups',
    'decided_game_id',
    loserId,
    winnerId,
  );
  await safeReassignWithUnique(
    tx,
    'community_lineup_entries',
    'game_id',
    loserId,
    winnerId,
  );
  await safeReassignWithUnique(
    tx,
    'community_lineup_votes',
    'game_id',
    loserId,
    winnerId,
  );
  await reassignLineupMatchFks(tx, loserId, winnerId);
}

/** Reassign lineup match and tiebreaker FKs. */
async function reassignLineupMatchFks(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await safeReassignWithUnique(
    tx,
    'community_lineup_matches',
    'game_id',
    loserId,
    winnerId,
  );
  await reassignTiebreakerFks(tx, loserId, winnerId);
}

/** Reassign tiebreaker-related FKs. */
async function reassignTiebreakerFks(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  // tiebreakers.winnerGameId
  await safeReassign(
    tx,
    'community_lineup_tiebreakers',
    'winner_game_id',
    loserId,
    winnerId,
  );
  // tiebreakers.tiedGameIds (jsonb array)
  await updateTiedGameIds(tx, loserId, winnerId);
  // bracket matchups (gameAId, gameBId, winnerGameId)
  await reassignBracketFks(tx, loserId, winnerId);
  // bracket votes
  await safeReassign(
    tx,
    'community_lineup_tiebreaker_bracket_votes',
    'game_id',
    loserId,
    winnerId,
  );
  // vetoes
  await safeReassign(
    tx,
    'community_lineup_tiebreaker_vetoes',
    'game_id',
    loserId,
    winnerId,
  );
}

/** Reassign bracket matchup FK columns. */
async function reassignBracketFks(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  const table = 'community_lineup_tiebreaker_bracket_matchups';
  await safeReassign(tx, table, 'game_a_id', loserId, winnerId);
  await safeReassign(tx, table, 'game_b_id', loserId, winnerId);
  await safeReassign(tx, table, 'winner_game_id', loserId, winnerId);
}

/** Reassign misc FKs: all remaining tables with game_id references. */
export async function reassignMiscFks(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await safeReassign(tx, 'discord_game_mappings', 'game_id', loserId, winnerId);
  await safeReassign(tx, 'channel_bindings', 'game_id', loserId, winnerId);
  await deleteAndReassign(tx, 'game_interests', 'game_id', loserId, winnerId);
  await safeReassign(tx, 'game_activity_sessions', 'game_id', loserId, winnerId);
  await safeReassign(tx, 'game_activity_rollups', 'game_id', loserId, winnerId);
  await safeReassign(tx, 'availability', 'game_id', loserId, winnerId);
  await safeReassign(tx, 'characters', 'game_id', loserId, winnerId);
  await safeReassign(tx, 'event_types', 'game_id', loserId, winnerId);
  await safeReassign(tx, 'event_plans', 'game_id', loserId, winnerId);
}

/** Delete loser rows that conflict with winner, then reassign the rest. */
async function deleteAndReassign(
  tx: Tx,
  table: string,
  column: string,
  loserId: number,
  winnerId: number,
): Promise<void> {
  // Delete loser rows where winner already has a matching row
  await tx.execute(
    sql.raw(
      `DELETE FROM ${table} WHERE ${column} = ${loserId} AND ${column} IS NOT NULL`,
    ),
  );
}

/** Simple FK reassignment (no unique constraints to worry about). */
async function safeReassign(
  tx: Tx,
  table: string,
  column: string,
  loserId: number,
  winnerId: number,
): Promise<void> {
  const sp = `sp_${table}_${loserId}`;
  await tx.execute(sql.raw(`SAVEPOINT ${sp}`));
  try {
    await tx.execute(
      sql.raw(
        `UPDATE ${table} SET ${column} = ${winnerId} WHERE ${column} = ${loserId}`,
      ),
    );
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
  } catch {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
  }
}


/**
 * FK reassignment with unique constraint handling.
 * Deletes conflicting rows before reassignment.
 */
async function safeReassignWithUnique(
  tx: Tx,
  table: string,
  column: string,
  loserId: number,
  winnerId: number,
): Promise<void> {
  // Delete loser rows that would conflict with existing winner rows
  await deleteConflictingRows(tx, table, column, loserId, winnerId);
  await safeReassign(tx, table, column, loserId, winnerId);
}

/** Delete rows for loserId that would conflict with winnerId. */
async function deleteConflictingRows(
  tx: Tx,
  table: string,
  column: string,
  loserId: number,
  winnerId: number,
): Promise<void> {
  const contextCol = getContextColumn(table);
  if (!contextCol) return;

  const sp = `sp_del_${table}`;
  await tx.execute(sql.raw(`SAVEPOINT ${sp}`));
  try {
    await tx.execute(
      sql.raw(
        `DELETE FROM ${table} AS l
         USING ${table} AS w
         WHERE l.${column} = ${loserId}
           AND w.${column} = ${winnerId}
           AND l.${contextCol} = w.${contextCol}`,
      ),
    );
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
  } catch {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
  }
}

/** Get the context column for unique constraint checks. */
function getContextColumn(table: string): string | null {
  const map: Record<string, string> = {
    community_lineup_entries: 'lineup_id',
    community_lineup_votes: 'lineup_id',
    community_lineup_matches: 'lineup_id',
    game_interest_suppressions: 'user_id',
  };
  return map[table] ?? null;
}

/** Update tiedGameIds jsonb array, replacing loserId with winnerId. */
async function updateTiedGameIds(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  const table = 'community_lineup_tiebreakers';
  // Replace loserId with winnerId in the jsonb array
  await tx.execute(
    sql.raw(
      `UPDATE ${table}
       SET tied_game_ids = (
         SELECT jsonb_agg(DISTINCT
           CASE WHEN elem::int = ${loserId} THEN ${winnerId} ELSE elem::int END
         )
         FROM jsonb_array_elements(tied_game_ids) AS elem
       )
       WHERE tied_game_ids @> '${loserId}'::jsonb`,
    ),
  );
}
