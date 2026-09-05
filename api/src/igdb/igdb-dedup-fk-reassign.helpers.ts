/**
 * FK reassignment helpers for game deduplication cleanup (ROK-1008).
 * Moves foreign key references from loser game rows to the winner,
 * handling unique constraint violations by skipping conflicting rows.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { updateJsonbGameIds } from './igdb-dedup-jsonb-game-ids.helpers';

export type Tx = Parameters<
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
  // ROK-1374: the tie hold's pick and tied-game list reference games too —
  // an un-reassigned pick would block deleting the loser (FK NO ACTION).
  await safeReassign(
    tx,
    'community_lineups',
    'tie_pick_game_id',
    loserId,
    winnerId,
  );
  await updateJsonbGameIds(
    tx,
    'community_lineups',
    'tie_game_ids',
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
  await updateJsonbGameIds(
    tx,
    'community_lineup_tiebreakers',
    'tied_game_ids',
    loserId,
    winnerId,
  );
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
  await safeReassign(
    tx,
    'game_activity_sessions',
    'game_id',
    loserId,
    winnerId,
  );
  // Playtime is real data — sum the loser's seconds into the winner's row for
  // colliding periods before the conflict-delete drops them (migration 0140's
  // semantics). Every other table below discards the losing row instead.
  await mergeActivityRollups(tx, loserId, winnerId);
  await safeReassignWithUnique(
    tx,
    'game_activity_rollups',
    'game_id',
    loserId,
    winnerId,
  );
  await safeReassign(tx, 'availability', 'game_id', loserId, winnerId);
  // A user can hold a main on BOTH rows; the partial unique index
  // `idx_one_main_per_game` (user_id, game_id) WHERE is_main would then abort
  // the merge. Demote the loser's main rather than delete the character.
  await demoteDuplicateMains(tx, loserId, winnerId);
  await safeReassignWithUnique(tx, 'characters', 'game_id', loserId, winnerId);
  await safeReassignWithUnique(tx, 'event_types', 'game_id', loserId, winnerId);
  await safeReassign(tx, 'event_plans', 'game_id', loserId, winnerId);
  // Table may not exist yet (pending migration) — savepoint protects txn
  await safeReassignWithUnique(
    tx,
    'game_interest_suppressions',
    'game_id',
    loserId,
    winnerId,
  );
  // `games_dedup_audit.canonical_game_id` is a notNull FK with NO `onDelete`,
  // so it RESTRICTs the loser's delete. The row describes a dup group that this
  // merge is dissolving, so it is deleted rather than repointed — repointing to
  // the winner would leave a self-referential group behind. The audit is a
  // regenerable snapshot (TRUNCATE+INSERT on every boot and every audit run),
  // and migration 0140 likewise truncates it post-merge, so nothing is lost.
  await deleteReferencing(
    tx,
    'games_dedup_audit',
    'canonical_game_id',
    loserId,
  );
}

/**
 * Additively merge the loser's activity rollups into the winner's for periods
 * both rows cover, so merged playtime is summed rather than discarded. Mirrors
 * step 1a of migration 0140. The conflict-delete in `safeReassignWithUnique`
 * then removes the loser's now-counted rows, and the plain reassign moves the
 * non-colliding remainder.
 */
async function mergeActivityRollups(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await tx.execute(
    sql.raw(
      `UPDATE game_activity_rollups w
          SET total_seconds = w.total_seconds + l.total_seconds
         FROM game_activity_rollups l
        WHERE w.game_id = ${winnerId}
          AND l.game_id = ${loserId}
          AND l.user_id = w.user_id
          AND l.period = w.period
          AND l.period_start = w.period_start`,
    ),
  );
}

/**
 * Clear `is_main` on the loser's characters where the same user already has a
 * main on the winner, so the partial unique index cannot see two mains for one
 * (user, game) after reassignment.
 */
async function demoteDuplicateMains(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await tx.execute(
    sql.raw(
      `UPDATE characters l
          SET is_main = false
        WHERE l.game_id = ${loserId}
          AND l.is_main = true
          AND EXISTS (
            SELECT 1 FROM characters w
             WHERE w.game_id = ${winnerId}
               AND w.user_id = l.user_id
               AND w.is_main = true
          )`,
    ),
  );
}

/**
 * Delete rows referencing the loser outright (for RESTRICT FKs whose rows are
 * meaningless once the group is merged). Savepoint-protected so a missing table
 * on an older schema cannot abort the enclosing transaction.
 */
async function deleteReferencing(
  tx: Tx,
  table: string,
  column: string,
  loserId: number,
): Promise<void> {
  const sp = `sp_del_ref_${table}`;
  await tx.execute(sql.raw(`SAVEPOINT ${sp}`));
  try {
    await tx.execute(
      sql.raw(`DELETE FROM ${table} WHERE ${column} = ${loserId}`),
    );
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
  } catch {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
  }
}

/** Delete conflicting loser rows (same user+source), then reassign rest. */
async function deleteAndReassign(
  tx: Tx,
  table: string,
  column: string,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await tx.execute(
    sql.raw(
      `DELETE FROM ${table} AS l USING ${table} AS w
       WHERE l.${column} = ${loserId} AND w.${column} = ${winnerId}
         AND l.user_id = w.user_id AND l.source = w.source`,
    ),
  );
  await safeReassign(tx, table, column, loserId, winnerId);
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
  const contextCols = getConflictColumns(table);
  if (!contextCols) return;

  // NULL-safe: `realm` and similar nullable key columns must compare equal when
  // both sides are NULL, which plain `=` does not do.
  const join = contextCols
    .map((c) => `l.${c} IS NOT DISTINCT FROM w.${c}`)
    .join(' AND ');

  const sp = `sp_del_${table}`;
  await tx.execute(sql.raw(`SAVEPOINT ${sp}`));
  try {
    await tx.execute(
      sql.raw(
        `DELETE FROM ${table} AS l
         USING ${table} AS w
         WHERE l.${column} = ${loserId}
           AND w.${column} = ${winnerId}
           AND ${join}`,
      ),
    );
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
  } catch {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
  }
}

/** Get the context column for unique constraint checks. */
/**
 * Columns that, together with `game_id`, form each table's UNIQUE constraint.
 *
 * A reassignment collides when the winner already holds a row matching the
 * loser's on ALL of these — so they are exactly the columns the pre-delete must
 * join on. Getting this list wrong in either direction is a real bug: too few
 * columns over-deletes rows that would not have collided (the previous
 * single-column `getContextColumn` deleted every loser vote in a lineup, not
 * just the ones for the same user), too many lets a genuine collision through
 * and aborts the transaction.
 *
 * Savepoints do NOT save us here. With postgres.js a failed statement poisons
 * the whole transaction — `ROLLBACK TO SAVEPOINT` runs, the loop continues, and
 * the driver still rejects at commit with the original error. `safeReassign`'s
 * catch is decorative for constraint violations, which is how ROK-1437's fix
 * surfaced this as the very next prod failure. Collisions must be PREVENTED.
 */
function getConflictColumns(table: string): string[] | null {
  const map: Record<string, string[]> = {
    // (lineup_id, game_id)
    community_lineup_entries: ['lineup_id'],
    community_lineup_matches: ['lineup_id'],
    // (lineup_id, user_id, game_id) — user_id was missing, over-deleting votes
    community_lineup_votes: ['lineup_id', 'user_id'],
    // (user_id, game_id)
    game_interest_suppressions: ['user_id'],
    // (user_id, game_id, name, realm)
    characters: ['user_id', 'name', 'realm'],
    // (game_id, slug)
    event_types: ['slug'],
    // (user_id, game_id, period, period_start) — additively merged first
    game_activity_rollups: ['user_id', 'period', 'period_start'],
  };
  return map[table] ?? null;
}
