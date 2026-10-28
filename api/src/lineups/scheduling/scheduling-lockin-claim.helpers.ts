/**
 * Per-match lock-in claim (ROK-2024 follow-up F2).
 *
 * The expired-poll lock-in used to create its event FIRST and only then try
 * the link compare-and-set, so the loser of two concurrent lock-ins left an
 * orphaned event that was already on Discord. It now takes this lock and
 * re-checks that the match is still unclaimed BEFORE creating anything: the
 * second caller blocks until the winner's transaction (holding the link
 * write) commits, then re-reads, sees the link and 409s with no event made.
 *
 * Two-argument `pg_advisory_xact_lock(int4, int4)`, the same form as
 * `scheduling-member-lock.helpers.ts`, keyed by the story id `2024`.
 *
 * The re-check is a plain read — NOT `FOR UPDATE`. `eventsService.create`
 * runs on its own pooled connection and its event insert takes `FOR KEY
 * SHARE` on this match row (the `created_from_poll_id` FK); a row lock held
 * here would make that insert wait on this transaction while this transaction
 * waits on the create — a wait Postgres cannot see as a deadlock.
 */
import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Advisory-lock class for match lock-ins (ROK-2024). */
export const MATCH_LOCKIN_LOCK_CLASS = 2024;

/** True while the match is schedulable (`suggested`/`scheduling`) and unlinked. */
export async function isMatchUnclaimed(
  db: Db,
  matchId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.communityLineupMatches.id })
    .from(schema.communityLineupMatches)
    .where(
      and(
        eq(schema.communityLineupMatches.id, matchId),
        inArray(schema.communityLineupMatches.status, [
          'suggested',
          'scheduling',
        ]),
        isNull(schema.communityLineupMatches.linkedEventId),
      ),
    )
    .limit(1);
  return rows.length !== 0;
}

/**
 * Run `fn` holding the match's lock-in lock, after confirming nobody has
 * locked the match in. Throws 409 before `fn` runs when someone has.
 *
 * `fn` must issue its link write on the `tx` it is handed, so the lock is only
 * released once that write is committed and visible to the next caller.
 */
export async function withMatchLockInClaim<T>(
  db: Db,
  matchId: number,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${MATCH_LOCKIN_LOCK_CLASS}::int4, ${matchId}::int4)`,
    );
    if (!(await isMatchUnclaimed(tx, matchId))) {
      throw new ConflictException('This poll has already been locked in');
    }
    return fn(tx);
  });
}
