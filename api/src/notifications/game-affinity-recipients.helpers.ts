/**
 * Shared "who has affinity for this game" recipient reads (ROK-1471).
 *
 * Extracted verbatim from `GameAffinityNotificationService` so the LFG
 * group-forming DM fan-out reuses the SAME consent read — the existing game
 * subscription — instead of growing a second definition of "interested in
 * this game" that would drift from the first.
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
}

/**
 * SQL predicate: hearted the game, or signed up for a past event of it.
 *
 * @param gameId - Game to measure affinity against.
 */
function affinityPredicate(gameId: number): SQL {
  return sql`(
    u.id IN (
      SELECT gi.user_id FROM game_interests gi WHERE gi.game_id = ${gameId}
    )
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
 * Deactivated users are ALWAYS excluded; banned users only when asked, so the
 * original game-alert behaviour is preserved byte-for-byte.
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
      AND ${affinityPredicate(gameId)}
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
