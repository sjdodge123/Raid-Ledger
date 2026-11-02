/**
 * ROK-2063 — B2 "First time the community played X", co-play only. A game is
 * a first when its first-ever co-play (rule a or b of
 * `weekly-digest-coplay.queries.ts`, with no lower time bound) falls inside
 * the digest week `[start, end)`. Solo play is never a first and never stops a
 * later co-play from being one.
 *
 * The week is half-open so consecutive digests chain: a co-play stamped
 * exactly at one week's end is the next week's first, never both.
 *
 * Lives outside `weekly-digest-milestones-sql.helpers.ts` because the co-play
 * query imports that file's predicates — a builder here avoids the cycle.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  coPlayParticipationSql,
  type CoPlayWindow,
} from './weekly-digest-coplay.queries';
import { VISIBLE_GAME } from './weekly-digest-milestones-sql.helpers';

/** A Date as a `timestamp` literal parameter (UTC wall clock, as stored). */
function ts(at: Date): SQL {
  return sql`${at.toISOString()}::timestamp`;
}

/**
 * B2 — visible games whose first-ever co-play is inside `week`, by name.
 * Rows: `game_id`, `name` (the shape `shapeFirstGames` reads).
 * `now` is when an open session is treated as ending (capped at `week.end`).
 */
export function buildFirstCoPlayGamesQuery(week: CoPlayWindow, now: Date): SQL {
  const allTime = coPlayParticipationSql({ start: null, end: week.end, now });
  return sql`
    SELECT g.id AS game_id, g.name AS name
    FROM (${allTime}) cp
    INNER JOIN games g ON g.id = cp.game_id
    WHERE ${VISIBLE_GAME}
    GROUP BY g.id, g.name
    HAVING MIN(cp.co_played_at) >= ${ts(week.start)}
       AND MIN(cp.co_played_at) < ${ts(week.end)}
    ORDER BY g.name ASC, g.id ASC
  `;
}
