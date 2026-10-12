/**
 * ROK-1771 L3 — spotlight candidate reads (spec §2 table A: A1, A3, A4, A5;
 * A2 duo lives in `weekly-digest-spotlight-duo.helpers.ts`). One read per
 * kind; each returns its candidate (raw facts) or `null` when the source has
 * no data. Eligibility and score are `pickSpotlight`'s job.
 *
 * Window: the digest's rolling `[NOW()-7d, NOW())`; "prior" = the 7 days
 * before it. Wherever a person's activity is counted, opted-out members
 * (`show_activity = false`), members who left/were banned/kicked and OAuth
 * guests never seen in the guild (`GUILD_MEMBER_SEEN`) are excluded at the
 * row level, so they contribute to nothing (AC10).
 */
import { and, inArray, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ACTIVE_MEMBER_SQL_AND } from '../users/users-active.helpers';
import { countVotesPerGame } from '../lineups/lineups-query.helpers';
import { VISIBILITY_FILTER } from '../igdb/igdb-visibility.helpers';
import {
  ATTENDED_SIGNUP_SQL,
  SHOWS_ACTIVITY_SQL,
} from './weekly-digest-recap.helpers';
import { GUILD_MEMBER_SEEN } from './weekly-digest-milestones-sql.helpers';
import { SPOTLIGHT_BARS } from './weekly-digest-spotlight.helpers';
import type {
  BossKillsCandidate,
  CommonGroundCandidate,
  MarathonCandidate,
  RisingGameCandidate,
} from './weekly-digest-spotlight.helpers';
import {
  pickNamedRunnerUp,
  rankedRunnerUps,
  shapeBossKills,
  shapeCommonGround,
  shapeMarathon,
  shapeRisingGame,
  type BossKillRow,
  type DecidedLineupRow,
  type MarathonRow,
  type RisingGameRow,
} from './weekly-digest-spotlight-shape.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const ACTIVE_MEMBER = sql.raw(ACTIVE_MEMBER_SQL_AND.trimEnd());
/** Raw-SQL twin of `VISIBILITY_FILTER` (hidden/banned games), alias `g`. */
const VISIBLE_GAME = sql.raw('g.hidden = false AND g.banned = false');

/**
 * A1 — per game, opted-out-filtered day-rollup seconds this week vs the
 * prior week; the biggest jump among games with enough players and hours.
 * `period_start` is a date: this week = the 7 dates after `NOW()-7d`.
 */
export function buildRisingGameQuery(): SQL {
  const bar = SPOTLIGHT_BARS.rising_game;
  return sql`
    WITH win AS (
      SELECT r.game_id, r.user_id,
        CASE WHEN r.period_start > (NOW() - INTERVAL '7 days')::date
          THEN r.total_seconds ELSE 0 END AS this_s,
        CASE WHEN r.period_start <= (NOW() - INTERVAL '7 days')::date
          THEN r.total_seconds ELSE 0 END AS prior_s
      FROM game_activity_rollups r
      INNER JOIN users u ON u.id = r.user_id
      WHERE r.period = 'day'
        AND r.period_start > (NOW() - INTERVAL '14 days')::date
        AND r.period_start <= NOW()::date${GUILD_MEMBER_SEEN}${ACTIVE_MEMBER}
        AND ${SHOWS_ACTIVITY_SQL('r.user_id')}
    )
    SELECT w.game_id, g.name AS game_name,
      SUM(w.this_s)::bigint AS this_seconds,
      SUM(w.prior_s)::bigint AS prior_seconds,
      (COUNT(DISTINCT w.user_id) FILTER (WHERE w.this_s > 0))::int AS player_count
    FROM win w
    INNER JOIN games g ON g.id = w.game_id
    WHERE ${VISIBLE_GAME}
    GROUP BY w.game_id, g.name
    HAVING SUM(w.this_s) >= ${bar.minHours * 3600}
      AND COUNT(DISTINCT w.user_id) FILTER (WHERE w.this_s > 0) >= ${bar.minPlayers}
    ORDER BY SUM(w.this_s) - SUM(w.prior_s) DESC, w.game_id
    LIMIT 1
  `;
}

/**
 * A3 — one row per distinct `(encounter_id, difficulty_id)` killed in the
 * window, oldest first. `first_ever`: some guild_key that killed it this
 * week had no successful pull of it before the window. Never reads `roster`.
 */
export function buildBossKillsQuery(): SQL {
  return sql`
    WITH kills AS (
      SELECT p.encounter_id, p.difficulty_id, p.guild_key,
             p.encounter_name, p.end_at
      FROM addon_encounter_pulls p
      WHERE p.success = true
        AND p.end_at >= NOW() - INTERVAL '7 days'
        AND p.end_at < NOW()
    )
    SELECT MIN(k.encounter_name) AS encounter_name,
      bool_or(NOT EXISTS (
        SELECT 1 FROM addon_encounter_pulls e
        WHERE e.success = true
          AND e.encounter_id = k.encounter_id
          AND e.difficulty_id = k.difficulty_id
          AND e.guild_key = k.guild_key
          AND e.end_at < NOW() - INTERVAL '7 days'
      )) AS first_ever
    FROM kills k
    GROUP BY k.encounter_id, k.difficulty_id
    ORDER BY MIN(k.end_at), k.encounter_id, k.difficulty_id
  `;
}

/**
 * A4 — the public, non-standalone lineup whose decision was announced in
 * the window. "Decided at" = `created_at` of its `lineup-decided:<id>`
 * dedup key (operator ruling Q2). Several → the one with the most votes.
 */
export function buildDecidedLineupQuery(): SQL {
  return sql`
    SELECT l.id AS lineup_id, l.decided_game_id,
           g.name AS decided_game_name
    FROM community_lineups l
    INNER JOIN notification_dedup d
      ON d.dedup_key = 'lineup-decided:' || l.id::text
    INNER JOIN games g ON g.id = l.decided_game_id
    WHERE l.visibility = 'public'
      AND ${VISIBLE_GAME}
      AND l.status IN ('decided', 'archived')
      AND COALESCE(l.phase_duration_override->>'standalone', 'false') <> 'true'
      AND d.created_at >= NOW() - INTERVAL '7 days'
      AND d.created_at <= NOW()
    ORDER BY (SELECT COUNT(*) FROM community_lineup_votes v
              WHERE v.lineup_id = l.id) DESC,
             d.created_at DESC, l.id DESC
    LIMIT 1
  `;
}

/**
 * A5 — the longest event that ended in the window with at least one
 * counted attendee (same attendance predicate as the recap's CTE).
 */
export function buildMarathonQuery(): SQL {
  return sql`
    WITH att AS (
      SELECT e.id AS event_id, e.title, e.duration, s.user_id
      FROM event_signups s
      INNER JOIN events e ON e.id = s.event_id
      INNER JOIN users u ON u.id = s.user_id
      WHERE ${ATTENDED_SIGNUP_SQL}
        AND upper(e.duration) >= NOW() - INTERVAL '7 days'
        AND upper(e.duration) <= NOW()${GUILD_MEMBER_SEEN}${ACTIVE_MEMBER}
        AND ${SHOWS_ACTIVITY_SQL('s.user_id')}
    )
    SELECT a.event_id, a.title AS event_title,
      EXTRACT(EPOCH FROM (upper(a.duration) - lower(a.duration))) / 60
        AS duration_minutes,
      COUNT(DISTINCT a.user_id)::int AS attendee_count
    FROM att a
    GROUP BY a.event_id, a.title, a.duration
    ORDER BY duration_minutes DESC, attendee_count DESC, a.event_id
    LIMIT 1
  `;
}

/** A1 — rising game candidate, or null without (enough) presence data. */
export async function fetchRisingGameCandidate(
  db: Db,
): Promise<RisingGameCandidate | null> {
  const rows = await db.execute<RisingGameRow>(buildRisingGameQuery());
  return shapeRisingGame(Array.from(rows)[0]);
}

/** A3 — boss kills candidate, or null without LedgerLink kills this week. */
export async function fetchBossKillsCandidate(
  db: Db,
): Promise<BossKillsCandidate | null> {
  const rows = await db.execute<BossKillRow>(buildBossKillsQuery());
  return shapeBossKills(Array.from(rows));
}

/** Names of the given games that still exist and are neither hidden nor banned. */
async function visibleGameNames(
  db: Db,
  gameIds: readonly number[],
): Promise<Map<number, string>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(and(inArray(schema.games.id, [...gameIds]), VISIBILITY_FILTER()));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** A4 — Common Ground result candidate, or null when none was decided. */
export async function fetchCommonGroundCandidate(
  db: Db,
): Promise<CommonGroundCandidate | null> {
  const rows = await db.execute<DecidedLineupRow>(buildDecidedLineupQuery());
  const lineup = Array.from(rows)[0];
  if (!lineup) return null;
  const votes = await countVotesPerGame(db, lineup.lineup_id);
  const winnerId = lineup.decided_game_id;
  const others = rankedRunnerUps(votes, winnerId).map((v) => v.gameId);
  const names = await visibleGameNames(db, others);
  return shapeCommonGround(
    lineup,
    votes,
    pickNamedRunnerUp(votes, winnerId, names),
  );
}

/** A5 — marathon candidate, or null when no attended event ended. */
export async function fetchMarathonCandidate(
  db: Db,
): Promise<MarathonCandidate | null> {
  const rows = await db.execute<MarathonRow>(buildMarathonQuery());
  return shapeMarathon(Array.from(rows)[0]);
}
