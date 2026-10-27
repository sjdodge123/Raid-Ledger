/**
 * Per-(poll, user) roster lock (ROK-2020, Codex P2).
 *
 * Removing a participant deletes their votes and THEN their membership row.
 * Under READ COMMITTED a concurrent `toggleVote` could slip a new vote in
 * between those two deletes (its `ensureMatchMember` still sees the old row),
 * commit, and leave a counted vote with no member behind it. Every write that
 * enrols a user via a vote, and the removal itself, therefore takes this lock
 * first, so the two serialise on the same `(matchId, userId)`.
 *
 * Two-argument `pg_advisory_xact_lock(int4, int4)` form, exactly like
 * `lineups-voting.helpers.ts::lockVoterStar`, so its keyspace is disjoint from
 * the one-argument `(bigint)` locks. `2020` is the story id. A lock instead of
 * catch-and-retry because postgres.js poisons the whole transaction on a
 * failed statement. MUST be issued on the transaction handle — work on the
 * outer `db` runs on another connection and is not covered.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Advisory-lock class for poll-roster writes (ROK-2020). */
export const MATCH_MEMBER_LOCK_CLASS = 2020;

/** Hold the `(matchId, userId)` roster lock until `tx` commits or rolls back. */
export async function lockMatchMember(
  tx: Db,
  matchId: number,
  userId: number,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${MATCH_MEMBER_LOCK_CLASS}::int4, hashtext(${`${matchId}:${userId}`}))`,
  );
}
