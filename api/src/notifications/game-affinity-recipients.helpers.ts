/**
 * Shared "who has affinity for this game" recipient reads (ROK-1471).
 *
 * Extracted verbatim from `GameAffinityNotificationService` so the LFG
 * group-forming DM fan-out reuses the SAME recipient read instead of growing a
 * second definition of "interested in this game" that would drift from it.
 *
 * The two callers differ on what counts as affinity, and deliberately so:
 * the game-alert fan-out keeps the historical "hearted OR played a past event
 * of it" read, while the LFG invite passes `interestsOnly` because its consent
 * story is the EXISTING game subscription and nothing else (ROK-1471 D11,
 * review R3).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** The Drizzle handle these reads run on. */
export type AffinityDb = PostgresJsDatabase<typeof schema>;

/** Knobs the two callers differ on. */
export interface AffinityRecipientOptions {
  /** User to omit (the event creator). `null` keeps everyone. */
  excludeUserId?: number | null;
  /** Also drop moderation-banned users (LFG invites — ROK-1471 D11). */
  excludeBanned?: boolean;
  /**
   * Count ONLY an explicit game subscription as affinity (ROK-1471 D11).
   *
   * The LFG invite DM's consent story is "you subscribed to this game", so it
   * must not reach someone whose only tie to the game is a signup a year ago.
   * The game-alert fan-out leaves this off and keeps the wider read.
   */
  interestsOnly?: boolean;
}

/** SQL predicate: holds an explicit subscription (heart) for the game. */
function subscribedPredicate(gameId: number): SQL {
  return sql`u.id IN (
      SELECT gi.user_id FROM game_interests gi WHERE gi.game_id = ${gameId}
    )`;
}

/**
 * SQL predicate: hearted the game, or signed up for a past event of it.
 *
 * @param gameId - Game to measure affinity against.
 * @param interestsOnly - Drop the inferred (past-signup) half.
 */
function affinityPredicate(gameId: number, interestsOnly: boolean): SQL {
  if (interestsOnly) return sql`(${subscribedPredicate(gameId)})`;
  return sql`(
    ${subscribedPredicate(gameId)}
    OR
    u.id IN (
      SELECT es.user_id FROM event_signups es
      INNER JOIN events e ON e.id = es.event_id
      WHERE e.game_id = ${gameId}
        AND upper(e.duration) < NOW()::timestamp
        AND es.status = 'signed_up'
        AND e.cancelled_at IS NULL
        AND es.user_id IS NOT NULL
    )
  )`;
}

/**
 * Find users with affinity for a game.
 *
 * Deactivated users are ALWAYS excluded; banned users and the inferred
 * (past-signup) half of the predicate only when asked, so the original
 * game-alert behaviour is preserved byte-for-byte.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game the recipients care about.
 * @param options - Optional self-exclusion and ban filtering.
 * @returns Distinct user ids, unordered.
 */
export async function findGameAffinityRecipients(
  db: AffinityDb,
  gameId: number,
  options: AffinityRecipientOptions = {},
): Promise<number[]> {
  const excludeUserId = options.excludeUserId ?? null;
  const notSelf =
    excludeUserId == null ? sql`TRUE` : sql`u.id != ${excludeUserId}`;
  const notBanned = options.excludeBanned
    ? sql`AND u.banned_at IS NULL`
    : sql.empty();
  const rows = await db.execute<{ id: number }>(sql`
    SELECT DISTINCT u.id FROM users u
    WHERE ${notSelf}
      AND u.deactivated_at IS NULL
      ${notBanned}
      AND ${affinityPredicate(gameId, options.interestsOnly === true)}
  `);
  return rows.map((r) => r.id);
}

/**
 * Find which of the candidates have an absence covering the given instant.
 *
 * @param db - Drizzle handle.
 * @param userIds - Candidate recipients; an empty list short-circuits.
 * @param atIso - Instant whose calendar date the absence must cover.
 * @returns The subset that is away.
 */
export async function findAbsentUserIds(
  db: AffinityDb,
  userIds: number[],
  atIso: string,
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const date = new Date(atIso).toISOString().split('T')[0];
  const rows = await db.execute<{ user_id: number }>(sql`
    SELECT DISTINCT a.user_id
    FROM game_time_absences a
    WHERE a.user_id IN (${sql.join(userIds, sql`, `)})
      AND ${date} >= a.start_date
      AND ${date} <= a.end_date
  `);
  return new Set(rows.map((r) => r.user_id));
}
