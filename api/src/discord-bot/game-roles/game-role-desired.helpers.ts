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
 * the event's effective end while the row is open), OR taking part in a Quick
 * Play (ad-hoc) session of the game (`ad_hoc_participants`, same time rules —
 * operator ruling 2026-10-15; picked up by the daily run / Run now only, no
 * grant-on-join). Restricted to active users with a real Discord snowflake
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

/**
 * Every play of `gameId` since `since`: presence starts + scheduled-event
 * voice + Quick Play participation. Shared with the removal-hint query so
 * "idle since" uses the same plays.
 */
export function playedCte(gameId: number, since: string, nowIso: string): SQL {
  return sql`
    WITH played AS (
      SELECT s.user_id, s.started_at AS played_at
        FROM game_activity_sessions s
       WHERE s.game_id = ${gameId}
         AND s.started_at >= ${since}::timestamp
      UNION ALL ${voiceBranch(gameId, since, nowIso)}
      UNION ALL ${quickPlayBranch(gameId, since, nowIso)}
    )
  `;
}

/** Scheduled-event voice attendance (ad-hoc events never write these rows). */
function voiceBranch(gameId: number, since: string, nowIso: string): SQL {
  const playedAt = openRowPlayedAt('v.last_leave_at', nowIso);
  return sql`
      SELECT COALESCE(v.user_id, vu.id), ${playedAt}
        FROM event_voice_sessions v
        JOIN events e ON e.id = v.event_id
        LEFT JOIN users vu
          ON v.user_id IS NULL AND vu.discord_id = v.discord_user_id
       WHERE e.game_id = ${gameId}
         AND COALESCE(v.user_id, vu.id) IS NOT NULL
         AND v.classification IS DISTINCT FROM 'no_show'
         AND (v.total_duration_sec > 0 OR v.last_leave_at IS NULL)
         AND ${playedAt} >= ${since}::timestamp`;
}

/** Quick Play (ad-hoc event) participation — operator ruling 2026-10-15. */
function quickPlayBranch(gameId: number, since: string, nowIso: string): SQL {
  const playedAt = openRowPlayedAt('a.left_at', nowIso);
  return sql`
      SELECT COALESCE(a.user_id, au.id), ${playedAt}
        FROM ad_hoc_participants a
        JOIN events e ON e.id = a.event_id
        LEFT JOIN users au
          ON a.user_id IS NULL AND au.discord_id = a.discord_user_id
       WHERE e.game_id = ${gameId}
         AND e.is_ad_hoc = true
         AND COALESCE(a.user_id, au.id) IS NOT NULL
         AND (a.total_duration_seconds > 0 OR a.left_at IS NULL)
         AND ${playedAt} >= ${since}::timestamp`;
}

/**
 * A voice / Quick Play row's played-at: its last leave, or — still open (in
 * voice now, or never closed after a bot outage) — `now` capped at the event's
 * effective end `COALESCE(extended_until, upper(duration))`, so a stale open
 * row cannot qualify forever. The ad-hoc lifecycle maintains the same pair
 * (`setEventEndTime` rewrites `upper(duration)` on finalize; the orphan sweep
 * keys on it). A snapshot row with `user_id` NULL resolves via
 * `discord_user_id`. `leftAtColumn` is a fixed column name, never input.
 */
function openRowPlayedAt(leftAtColumn: string, nowIso: string): SQL {
  return sql`COALESCE(${sql.raw(leftAtColumn)}, LEAST(${nowIso}::timestamp,
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
