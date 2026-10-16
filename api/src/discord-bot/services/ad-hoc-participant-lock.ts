/**
 * ROK-1800 — serialise a linked user's participant writes on one event.
 *
 * A voice join and a game-server join for the same user can land at once.
 * Both do find-then-insert keyed on `user_id`, and the two partial uniques
 * (Discord id / SteamID) cannot see each other, so without a lock both insert
 * and one person shows twice. The transaction-scoped advisory lock holds for
 * the whole find-then-write; work MUST use the `tx` handed to `fn`.
 *
 * No catch-and-retry inside: under postgres.js a failed statement poisons the
 * whole transaction (see CLAUDE.md, games-table INSERT paths).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Advisory-lock class for ad-hoc participant identity (two-int form). */
export const AD_HOC_PARTICIPANT_LOCK_CLASS = 1800;

/**
 * Run `fn` under a per-(event, user) lock. Unlinked members (`userId` null)
 * can never merge across sources, so they run unlocked on `db`.
 */
export async function withParticipantLock<T>(
  db: Db,
  eventId: number,
  userId: number | null,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  if (userId === null) return fn(db);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${AD_HOC_PARTICIPANT_LOCK_CLASS}::int4, hashtext(${`${eventId}:${userId}`}))`,
    );
    return fn(tx);
  });
}
