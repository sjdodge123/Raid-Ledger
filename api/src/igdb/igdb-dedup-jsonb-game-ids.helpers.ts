/**
 * Games dedup — rewrite a jsonb array of game ids in place (ROK-1374 split
 * out of `igdb-dedup-fk-reassign.helpers.ts`, which sits at the file cap).
 *
 * Used for `community_lineup_tiebreakers.tied_game_ids` and, since the tie
 * hold, `community_lineups.tie_game_ids`: a merged loser id becomes the winner
 * id, de-duplicated, so a hold never names a game that no longer exists.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from './igdb-dedup-fk-reassign.helpers';

/** Replace loserId with winnerId inside `table.column` (a jsonb id array). */
export async function updateJsonbGameIds(
  tx: Tx,
  table: string,
  column: string,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await tx.execute(
    sql.raw(
      `UPDATE ${table}
       SET ${column} = (
         SELECT jsonb_agg(DISTINCT
           CASE WHEN elem::int = ${loserId} THEN ${winnerId} ELSE elem::int END
         )
         FROM jsonb_array_elements(${column}) AS elem
       )
       WHERE ${column} @> '${loserId}'::jsonb`,
    ),
  );
}
