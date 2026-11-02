/**
 * ROK-2063 — B2 "First time the community played X", co-play only. A game is
 * a first when its first-ever co-play (rule a or b of
 * `weekly-digest-coplay.queries.ts`) falls inside the digest week
 * `[start, end)`. Solo play is never a first and never stops a later co-play
 * from being one.
 *
 * Shape (bounded — the sessions table is never pruned):
 *  1. Candidates: games co-played THIS week, from the week-bounded
 *     `coPlayParticipationSql` (visible members only — AC10: an opted-out
 *     partner never makes a first).
 *  2. Keep a candidate only if NO co-play exists before `start`: two inline,
 *     correlated `NOT EXISTS` probes per candidate game. The session probe
 *     walks the game's earlier sessions on the `(game_id, started_at)` index
 *     and, per session, range-scans the same index for a partner starting in
 *     `[a.start - 25h, a.end - 15min]` (sessions are clipped to 25h, see
 *     `MAX_SESSION_SPAN_HOURS`), short-circuiting on the first hit.
 *
 * History is deliberately NOT filtered by current membership or opt-out:
 * co-play by people who have since left still happened, so it is no first.
 * An overlap is credited to the week holding the instant it reaches 15 min
 * (`GREATEST(starts) + 15 min`): this week's candidates need that instant in
 * `[start, end)`, the history probe needs it before `start`. So a co-play
 * straddling the boundary is a first in exactly one week and never suppresses
 * itself. The week is half-open: an event ending exactly at `end` is the next
 * week's first, never both.
 *
 * Lives outside `weekly-digest-milestones-sql.helpers.ts` because the co-play
 * query imports that file's predicates — a builder here avoids the cycle.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  coPlayParticipationSql,
  MIN_OVERLAP_SQL,
  pgTimestamp,
  SESSION_SPAN_SQL,
  type CoPlayWindow,
} from './weekly-digest-coplay.queries';
import { VISIBLE_GAME } from './weekly-digest-milestones-sql.helpers';
import { ATTENDED_SIGNUP_SQL } from './weekly-digest-recap.helpers';

/** `alias`'s session end: open → `before`, capped at the 25h span. */
function historyEnd(alias: 'ha' | 'hb', before: SQL): SQL {
  const a = sql.raw(alias);
  return sql`LEAST(COALESCE(${a}.ended_at, ${before}), ${a}.started_at + ${SESSION_SPAN_SQL})`;
}

/** No two people's sessions on `g.id` reached a 15-min overlap before `before`. */
function noEarlierSessionCoPlay(before: SQL): SQL {
  const aEnd = historyEnd('ha', before);
  const reached = sql`GREATEST(ha.started_at, hb.started_at) + ${MIN_OVERLAP_SQL}`;
  return sql`NOT EXISTS (
      SELECT 1 FROM game_activity_sessions ha
      WHERE ha.game_id = g.id
        AND ha.started_at < ${before} - ${MIN_OVERLAP_SQL}
        AND EXISTS (
          SELECT 1 FROM game_activity_sessions hb
          WHERE hb.game_id = ha.game_id
            AND hb.user_id <> ha.user_id
            AND hb.started_at BETWEEN ha.started_at - ${SESSION_SPAN_SQL} AND ${aEnd} - ${MIN_OVERLAP_SQL}
            AND ${reached} < ${before}
            AND ${reached} <= LEAST(${aEnd}, ${historyEnd('hb', before)})
        )
    )`;
}

/** No attended event for `g.id` ending before `before` had 2+ attendees. */
function noEarlierEventCoPlay(before: SQL): SQL {
  return sql`NOT EXISTS (
      SELECT 1 FROM events he
      WHERE he.game_id = g.id
        AND upper(he.duration) < ${before}
        AND (
          SELECT COUNT(DISTINCT s.user_id) FROM event_signups s
          INNER JOIN events e ON e.id = s.event_id
          WHERE e.id = he.id AND ${ATTENDED_SIGNUP_SQL}
        ) >= 2
    )`;
}

/**
 * B2 — visible games whose first-ever co-play is inside `week`, by name.
 * Rows: `game_id`, `name` (the shape `shapeFirstGames` reads).
 * `now` is when an open session is treated as ending (capped at `week.end`).
 */
export function buildFirstCoPlayGamesQuery(week: CoPlayWindow, now: Date): SQL {
  const thisWeek = coPlayParticipationSql({ ...week, now, members: 'visible' });
  const start = pgTimestamp(week.start);
  return sql`
    SELECT g.id AS game_id, g.name AS name
    FROM (
      SELECT DISTINCT cp.game_id FROM (${thisWeek}) cp
      WHERE cp.co_played_at < ${pgTimestamp(week.end)}
    ) c
    INNER JOIN games g ON g.id = c.game_id
    WHERE ${VISIBLE_GAME}
      AND ${noEarlierSessionCoPlay(start)}
      AND ${noEarlierEventCoPlay(start)}
    ORDER BY g.name ASC, g.id ASC
  `;
}
