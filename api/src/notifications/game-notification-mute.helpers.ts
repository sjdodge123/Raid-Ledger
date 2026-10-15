/**
 * Per-game notification mute gate (ROK-1797).
 *
 * One predicate, many readers (the ROK-1796 lesson): every per-game broadcast
 * recipient read (ROK-992, ROK-1229 …) MUST AND this. It is applied as an
 * OUTER filter on the user id, never folded into `interestedRowCondition` —
 * that condition also drives heart counts and search sort, and a mute must
 * not hide a heart. Muting removes the in-app row, push and DM alike, because
 * the user is dropped at recipient selection.
 */
import { sql, type SQL } from 'drizzle-orm';

/**
 * SQL predicate: the user has NOT muted notifications for this game.
 *
 * @param gameId - Game the broadcast is about.
 * @param userCol - Outer-query user id column; defaults to `u.id`.
 * @returns A `NOT EXISTS` fragment to AND into a recipient `WHERE`.
 */
export function notGameMutedSql(
  gameId: number,
  userCol: SQL = sql.raw('u.id'),
): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM game_notification_mutes gnm
    WHERE gnm.user_id = ${userCol} AND gnm.game_id = ${gameId}
  )`;
}
