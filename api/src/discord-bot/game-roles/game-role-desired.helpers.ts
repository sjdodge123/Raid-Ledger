import { sql, type SQL } from 'drizzle-orm';
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
 * time in voice or still in voice; played-at = last leave, or `now` capped at
 * the event's effective end while the row is open). Restricted to active users with a real Discord snowflake
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
  const rows = await db.execute<DesiredRow>(
    sql`${playedCte(gameId, since, nowIso)}
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
  `,
  );
  return toDesiredMap(rows);
}

/** Every play of `gameId` since `since`: presence starts + event voice. */
function playedCte(gameId: number, since: string, nowIso: string): SQL {
  const playedAt = voicePlayedAt(nowIso);
  return sql`
    WITH played AS (
      SELECT s.user_id, s.started_at AS played_at
        FROM game_activity_sessions s
       WHERE s.game_id = ${gameId}
         AND s.started_at >= ${since}::timestamp
      UNION ALL
      SELECT COALESCE(v.user_id, vu.id), ${playedAt}
        FROM event_voice_sessions v
        JOIN events e ON e.id = v.event_id
        LEFT JOIN users vu
          ON v.user_id IS NULL AND vu.discord_id = v.discord_user_id
       WHERE e.game_id = ${gameId}
         AND COALESCE(v.user_id, vu.id) IS NOT NULL
         AND v.classification IS DISTINCT FROM 'no_show'
         AND (v.total_duration_sec > 0 OR v.last_leave_at IS NULL)
         AND ${playedAt} >= ${since}::timestamp
    )
  `;
}

/**
 * A voice row's played-at: its last leave, or — still open (in voice now, or
 * never closed after a bot outage) — `now` capped at the event's effective
 * end, so a stale open row cannot qualify forever. A start-of-event snapshot
 * row has `user_id` NULL and is resolved through `discord_user_id` above.
 */
function voicePlayedAt(nowIso: string): SQL {
  return sql`COALESCE(v.last_leave_at, LEAST(${nowIso}::timestamp,
    COALESCE(e.extended_until, upper(e.duration))))`;
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
