import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { GAME_ROLES_OPT_OUT_PREF_KEY } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';

/** One member who should hold a game's role, and when they last played. */
export interface DesiredMember {
  discordUserId: string;
  lastPlayedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type DesiredRow = {
  user_id: number;
  discord_id: string;
  last_played_epoch: number | string;
} & Record<string, unknown>;

/**
 * ROK-1767: the members who "played" `gameId` within the last `windowDays`.
 *
 * Played = a presence session that started in the window, OR attendance at a
 * scheduled event for the game (voice row not classified `no_show`, with
 * time in voice or still in voice; played-at = last leave, or `now` while
 * still in voice). Restricted to active users with a real Discord snowflake
 * (same predicate as `guild-reconciliation.service.ts::activeSnowflakeUser`)
 * who have not opted out. Guild membership is NOT checked here — the caller
 * intersects with the live member fetch.
 */
export async function findDesiredMembers(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  windowDays: number,
  now: Date,
): Promise<Map<number, DesiredMember>> {
  const since = new Date(now.getTime() - windowDays * DAY_MS).toISOString();
  const nowIso = now.toISOString();
  const rows = await db.execute<DesiredRow>(sql`
    WITH played AS (
      SELECT s.user_id, s.started_at AS played_at
        FROM game_activity_sessions s
       WHERE s.game_id = ${gameId}
         AND s.started_at >= ${since}::timestamp
      UNION ALL
      SELECT v.user_id, COALESCE(v.last_leave_at, ${nowIso}::timestamp)
        FROM event_voice_sessions v
        JOIN events e ON e.id = v.event_id
       WHERE e.game_id = ${gameId}
         AND v.user_id IS NOT NULL
         AND v.classification IS DISTINCT FROM 'no_show'
         AND (v.total_duration_sec > 0 OR v.last_leave_at IS NULL)
         AND COALESCE(v.last_leave_at, ${nowIso}::timestamp) >= ${since}::timestamp
    )
    SELECT u.id AS user_id, u.discord_id,
           EXTRACT(EPOCH FROM MAX(p.played_at))::float8 AS last_played_epoch
      FROM played p
      JOIN users u ON u.id = p.user_id
     WHERE u.deactivated_at IS NULL
       AND u.discord_id IS NOT NULL
       AND u.discord_id NOT LIKE 'local:%'
       AND u.discord_id NOT LIKE 'unlinked:%'
       AND NOT EXISTS (
         SELECT 1 FROM user_preferences up
          WHERE up.user_id = u.id
            AND up.key = ${GAME_ROLES_OPT_OUT_PREF_KEY}
            AND up.value = 'true'::jsonb
       )
     GROUP BY u.id, u.discord_id
  `);
  return toDesiredMap(rows);
}

function toDesiredMap(rows: Iterable<DesiredRow>): Map<number, DesiredMember> {
  const out = new Map<number, DesiredMember>();
  for (const r of rows) {
    out.set(Number(r.user_id), {
      discordUserId: r.discord_id,
      lastPlayedAt: new Date(Number(r.last_played_epoch) * 1000),
    });
  }
  return out;
}
