/**
 * ROK-2063 — what the digest counts as "played together". A game qualifies
 * when either:
 *  (a) 2+ distinct active guild members' `game_activity_sessions` on it
 *      overlap by ≥ {@link CO_PLAY_MIN_OVERLAP_MINUTES}, measured inside the
 *      bounds (an open session runs until `now`, capped at the bound's end); or
 *  (b) an attended event for it, ending inside the bounds, had 2+ attended
 *      signups by active guild members.
 * "Active guild member" is the digest's one rule: guild-seen, not
 * deactivated/banned/kicked, and not opted out of `show_activity` — the same
 * predicates `weekly-digest-spotlight-duo.helpers.ts` applies.
 *
 * Steam `playtime_2weeks` is deliberately absent: it carries no timing.
 * `/games` keeps its own read (`fetchCommunityPlayingRow`), unchanged.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { ACTIVE_MEMBER_SQL_AND } from '../users/users-active.helpers';
import {
  GUILD_MEMBER_SEEN,
  VISIBLE_GAME,
} from './weekly-digest-milestones-sql.helpers';
import {
  ATTENDED_SIGNUP_SQL,
  SHOWS_ACTIVITY_SQL,
} from './weekly-digest-recap.helpers';

/** Shortest session overlap between two members that counts as co-play. */
export const CO_PLAY_MIN_OVERLAP_MINUTES = 15;

/** Days in the digest's co-play week. */
export const CO_PLAY_WINDOW_DAYS = 7;

/** A closed time window, `start` ≤ t ≤ `end`. */
export interface CoPlayWindow {
  start: Date;
  end: Date;
}

/** Bounds for {@link coPlayParticipationSql}; `start: null` = since forever. */
export interface CoPlayBounds {
  start: Date | null;
  end: Date;
  /** The instant an open session is treated as ending at (capped at `end`). */
  now: Date;
}

/** Options for {@link fetchCoPlayGames}. */
export interface CoPlayOptions {
  /** Clock for open sessions; defaults to the current time. */
  now?: Date;
}

/** One game played together in the window. */
export interface CoPlayGame {
  gameId: number;
  name: string;
  slug: string;
  /** Distinct active members who took part in a qualifying co-play. */
  players: number;
}

/** Raw row of {@link buildCoPlayGamesQuery}. */
type CoPlayGameRow = {
  game_id: number;
  name: string;
  slug: string;
  players: number | string;
};

/** A Date as a `timestamp` literal parameter (UTC wall clock, as drizzle stores it). */
function ts(at: Date): SQL {
  return sql`${at.toISOString()}::timestamp`;
}

/** The members filter on a `users u` join (guild-seen, active, not opted out). */
const ACTIVE_MEMBER = sql`${GUILD_MEMBER_SEEN}${sql.raw(ACTIVE_MEMBER_SQL_AND.trimEnd())}
      AND ${SHOWS_ACTIVITY_SQL('u.id')}`;

/** Rule (a) input: active members' sessions on a game, clipped to the bounds. */
function clippedSessionsCte(b: CoPlayBounds): SQL {
  const openEnd = ts(b.now.getTime() < b.end.getTime() ? b.now : b.end);
  const from = b.start
    ? sql`GREATEST(gs.started_at, ${ts(b.start)})`
    : sql`gs.started_at`;
  const lower = b.start
    ? sql` AND COALESCE(gs.ended_at, ${openEnd}) > ${ts(b.start)}`
    : sql``;
  return sql`
  cp_sessions AS (
    SELECT gs.user_id, gs.game_id, ${from} AS s_from,
           LEAST(COALESCE(gs.ended_at, ${openEnd}), ${ts(b.end)}) AS s_to
    FROM game_activity_sessions gs
    INNER JOIN users u ON u.id = gs.user_id
    WHERE gs.game_id IS NOT NULL
      AND gs.started_at < ${ts(b.end)}${lower}${ACTIVE_MEMBER}
  )`;
}

/** Rule (a): each member of a pair whose sessions overlapped ≥ the minimum. */
const SESSION_PAIRS_CTE = sql`
  cp_pairs AS (
    SELECT a.game_id, a.user_id, GREATEST(a.s_from, b.s_from) AS co_played_at
    FROM cp_sessions a
    INNER JOIN cp_sessions b
      ON b.game_id = a.game_id AND b.user_id <> a.user_id
     AND b.s_from < a.s_to AND a.s_from < b.s_to
    WHERE LEAST(a.s_to, b.s_to) - GREATEST(a.s_from, b.s_from)
          >= make_interval(mins => ${sql.raw(String(CO_PLAY_MIN_OVERLAP_MINUTES))})
  )`;

/** Rule (b) input: active members' attended signups on game events in bounds. */
function attendedEventsCte(b: CoPlayBounds): SQL {
  const lower = b.start ? sql` AND upper(e.duration) >= ${ts(b.start)}` : sql``;
  return sql`
  cp_attended AS (
    SELECT e.id AS event_id, e.game_id, s.user_id,
           upper(e.duration) AS co_played_at
    FROM event_signups s
    INNER JOIN events e ON e.id = s.event_id
    INNER JOIN users u ON u.id = s.user_id
    WHERE ${ATTENDED_SIGNUP_SQL}
      AND e.game_id IS NOT NULL
      AND upper(e.duration) <= ${ts(b.end)}${lower}${ACTIVE_MEMBER}
  )`;
}

/**
 * Firsts-reusable building block: `SELECT game_id, user_id, co_played_at` — one
 * row per member per qualifying co-play (rule a or b). Wrap as `(…) cp`.
 */
export function coPlayParticipationSql(bounds: CoPlayBounds): SQL {
  return sql`
  WITH ${clippedSessionsCte(bounds)},
  ${SESSION_PAIRS_CTE},
  ${attendedEventsCte(bounds)}
  SELECT p.game_id, p.user_id, p.co_played_at FROM cp_pairs p
  UNION ALL
  SELECT ea.game_id, ea.user_id, ea.co_played_at FROM cp_attended ea
  WHERE ea.event_id IN (
    SELECT eb.event_id FROM cp_attended eb
    GROUP BY eb.event_id HAVING COUNT(DISTINCT eb.user_id) >= 2
  )`;
}

/** Games played together in the bounds, most players first, then by name. */
export function buildCoPlayGamesQuery(bounds: CoPlayBounds): SQL {
  return sql`
    SELECT g.id AS game_id, g.name, g.slug,
           COUNT(DISTINCT cp.user_id)::int AS players
    FROM (${coPlayParticipationSql(bounds)}) cp
    INNER JOIN games g ON g.id = cp.game_id
    WHERE ${VISIBLE_GAME}
    GROUP BY g.id, g.name, g.slug
    ORDER BY players DESC, g.name ASC, g.id ASC
  `;
}

/** The digest's co-play week: the {@link CO_PLAY_WINDOW_DAYS} days ending at `now`. */
export function digestCoPlayWindow(now: Date = new Date()): CoPlayWindow {
  const start = new Date(now.getTime() - CO_PLAY_WINDOW_DAYS * 86_400_000);
  return { start, end: now };
}

/** Every game played together in `window` (rules a/b), ranked by players. */
export async function fetchCoPlayGames(
  db: PostgresJsDatabase<typeof schema>,
  window: CoPlayWindow,
  opts: CoPlayOptions = {},
): Promise<CoPlayGame[]> {
  const bounds = { ...window, now: opts.now ?? new Date() };
  const rows = await db.execute<CoPlayGameRow>(buildCoPlayGamesQuery(bounds));
  return Array.from(rows, (r) => ({
    gameId: r.game_id,
    name: r.name,
    slug: r.slug,
    players: Number(r.players),
  }));
}
