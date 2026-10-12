/**
 * ROK-1771 slice L2 — the four "Firsts & milestones" SQL reads (spec §2 table B).
 * Shaping, thresholds and the fetch orchestrator live in
 * `weekly-digest-milestones.helpers.ts`; this file only builds queries.
 *
 * Window: `[NOW() - 7 days, NOW()]`, the same as the recap. Rollup rows are
 * per-day `date`s, so their side of the window compares against
 * `(NOW() - 7 days)::date`; event rows compare `upper(duration)` against the
 * timestamp itself, exactly like the recap's `attended` CTE.
 *
 * Privacy (AC10): every row that NAMES a member, or that is the only evidence
 * of this week's activity, passes `SHOWS_ACTIVITY_SQL` (imported, never
 * redefined). History checks ("was it played before?", "hours before the
 * window") read every row — that can only suppress a line, never reveal one.
 */
import { sql, type SQL } from 'drizzle-orm';
import { ACTIVE_MEMBER_SQL_AND } from '../users/users-active.helpers';
import {
  ATTENDED_SIGNUP_SQL,
  RECAP_WINDOW_DAYS,
  SHOWS_ACTIVITY_SQL,
} from './weekly-digest-recap.helpers';

/** Window start as a timestamp expression (no bound params). */
const WINDOW_START = sql.raw(`(NOW() - INTERVAL '${RECAP_WINDOW_DAYS} days')`);
/** Window start as a date, for `game_activity_rollups.period_start`. */
const WINDOW_START_DATE = sql.raw(
  `(NOW() - INTERVAL '${RECAP_WINDOW_DAYS} days')::date`,
);
const ACTIVE_MEMBER = sql.raw(ACTIVE_MEMBER_SQL_AND.trimEnd());

/**
 * AC10: a read that NAMES a member also requires they were actually seen in
 * the guild, so a Discord-OAuth guest (poll link / PUG invite) is never
 * named. Alias `u` = users. The one definition — B1, B3 and the duo use it.
 */
export const GUILD_MEMBER_SEEN = sql.raw(
  ' AND u.guild_member_seen_at IS NOT NULL',
);

/**
 * The shared "attended" rule (`ATTENDED_SIGNUP_SQL`, the same one the recap
 * uses) plus "event already ended"; no window bounds. Alias `s` = event_signups, `e` = events.
 */
const ATTENDED_ENDED = sql`${ATTENDED_SIGNUP_SQL}
      AND upper(e.duration) <= NOW()`;

/** B1 — accounts created in the window by members actually seen in the guild. */
export function buildNewMembersQuery(): SQL {
  return sql`
    SELECT u.id AS user_id,
           COALESCE(NULLIF(u.display_name, ''), u.username) AS name
    FROM users u
    WHERE u.created_at >= ${WINDOW_START}
      ${GUILD_MEMBER_SEEN}${ACTIVE_MEMBER}
      AND ${SHOWS_ACTIVITY_SQL('u.id')}
    ORDER BY u.created_at ASC, u.id ASC
  `;
}

/**
 * B3 — per member, attended-event counts before the window and through now,
 * for members with at least one attended event ending in the window and at
 * least `minThreshold` overall. Threshold crossing is decided in TypeScript.
 */
export function buildEventMilestonesQuery(minThreshold: number): SQL {
  return sql`
    WITH attended AS (
      SELECT s.user_id, e.id AS event_id, upper(e.duration) AS ended_at
      FROM event_signups s
      INNER JOIN events e ON e.id = s.event_id
      WHERE ${ATTENDED_ENDED}
    )
    SELECT u.id AS user_id,
           COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
           COUNT(DISTINCT a.event_id)
             FILTER (WHERE a.ended_at < ${WINDOW_START})::int AS before_count,
           COUNT(DISTINCT a.event_id)::int AS through_count
    FROM attended a
    INNER JOIN users u ON u.id = a.user_id
    WHERE TRUE${GUILD_MEMBER_SEEN}${ACTIVE_MEMBER}
      AND ${SHOWS_ACTIVITY_SQL('u.id')}
    GROUP BY u.id, u.display_name, u.username
    HAVING COUNT(*) FILTER (WHERE a.ended_at >= ${WINDOW_START}) > 0
       AND COUNT(DISTINCT a.event_id) >= ${minThreshold}
  `;
}

/** B2's games with privacy-visible activity this week, from either source. */
const RECENT_GAMES_CTE = sql`recent AS (
      SELECT r.game_id FROM game_activity_rollups r
      INNER JOIN users u ON u.id = r.user_id
      WHERE r.period = 'day' AND r.period_start >= ${WINDOW_START_DATE}
        AND r.total_seconds > 0${ACTIVE_MEMBER}
        AND ${SHOWS_ACTIVITY_SQL('r.user_id')}
      UNION
      SELECT e.game_id FROM event_signups s
      INNER JOIN events e ON e.id = s.event_id
      INNER JOIN users u ON u.id = s.user_id
      WHERE ${ATTENDED_ENDED} AND e.game_id IS NOT NULL
        AND upper(e.duration) >= ${WINDOW_START}${ACTIVE_MEMBER}
        AND ${SHOWS_ACTIVITY_SQL('s.user_id')}
    )`;

/**
 * B2 — games with visible activity this week (presence rollups OR an attended
 * event) and NO activity of any kind before the window. With no rollups the
 * presence half contributes nothing and the event half still works.
 */
export function buildFirstGamesQuery(): SQL {
  return sql`
    WITH ${RECENT_GAMES_CTE}
    SELECT g.id AS game_id, g.name AS name
    FROM recent rc
    INNER JOIN games g ON g.id = rc.game_id
    WHERE NOT EXISTS (
        SELECT 1 FROM game_activity_rollups r2
        WHERE r2.game_id = rc.game_id AND r2.period = 'day'
          AND r2.period_start < ${WINDOW_START_DATE} AND r2.total_seconds > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_signups s
        INNER JOIN events e ON e.id = s.event_id
        WHERE e.game_id = rc.game_id AND ${ATTENDED_ENDED}
          AND upper(e.duration) < ${WINDOW_START}
      )
    ORDER BY g.name ASC, g.id ASC
  `;
}

/**
 * B4 — all-time community seconds per game before the window and through now,
 * opted-out members' rows excluded, bounded to games with rollups this week.
 * Deactivated members' hours stay in: the total is community history and must
 * not shrink (a shrinking total could re-cross a threshold and repeat a line).
 */
export function buildHourMilestonesQuery(minSeconds: number): SQL {
  return sql`
    SELECT r.game_id, g.name AS name,
           COALESCE(SUM(r.total_seconds)
             FILTER (WHERE r.period_start < ${WINDOW_START_DATE}), 0)::bigint
             AS seconds_before,
           SUM(r.total_seconds)::bigint AS seconds_through
    FROM game_activity_rollups r
    INNER JOIN games g ON g.id = r.game_id
    WHERE r.period = 'day'
      AND ${SHOWS_ACTIVITY_SQL('r.user_id')}
      AND r.game_id IN (
        SELECT DISTINCT game_id FROM game_activity_rollups
        WHERE period = 'day' AND period_start >= ${WINDOW_START_DATE}
      )
    GROUP BY r.game_id, g.name
    HAVING SUM(r.total_seconds) >= ${minSeconds}
  `;
}
