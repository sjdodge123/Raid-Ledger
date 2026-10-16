/**
 * Recipient read for the standalone scheduling-poll "interested users" DM
 * fan-out: users with affinity for the game, excluding the creator.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { INTERESTED_GI_ROW } from '../../igdb/igdb-interest-sources.helpers';
import { notGameMutedSql } from '../../notifications/game-notification-mute.helpers';

/**
 * Users who hold an interest row for the game (an un-hearted Steam owner does
 * not — ROK-1796) or signed up for any non-cancelled event of it, minus
 * anyone who muted the game's notifications (ROK-1797).
 *
 * @param db - Drizzle handle.
 * @param gameId - Game the poll schedules.
 * @param creatorId - Poll creator, never a recipient.
 * @returns Distinct recipient user ids.
 */
export async function findStandalonePollRecipients(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  creatorId: number,
): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    SELECT DISTINCT u.id FROM users u
    WHERE u.id != ${creatorId}
      AND (
        u.id IN (
          SELECT gi.user_id FROM game_interests gi
          WHERE gi.game_id = ${gameId} AND ${INTERESTED_GI_ROW}
        )
        OR
        u.id IN (
          SELECT es.user_id FROM event_signups es
          INNER JOIN events e ON e.id = es.event_id
          WHERE e.game_id = ${gameId}
            AND es.status = 'signed_up'
            AND e.cancelled_at IS NULL
            AND es.user_id IS NOT NULL
        )
      )
      AND ${notGameMutedSql(gameId)}
  `);
  return rows.map((r) => r.id);
}
