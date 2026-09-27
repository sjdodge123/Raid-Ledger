/**
 * ROK-1691 — the board post-age cap's selection.
 *
 * A pure query builder, not a query: the expiry sweep embeds it as the
 * `game_id IN (...)` arm of its ONE existing UPDATE, so an aged post's hands
 * lapse in the same statement, come back through the same RETURNING, and reach
 * the board through the same per-game `expired` emit as a natural lapse.
 */
import { and, eq, sql } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import * as schema from '../drizzle/schema';
import { computePostAgeCutoff } from './lfg.constants';

const posts = schema.lfgGroupMessages;

/**
 * Games whose OPEN forum post opened on or before the post-age cutoff.
 *
 * Only `open` rows: a closed row's thread is already archived. Only `forum`
 * rows: the cap is a board rule, and the legacy text surface keeps its own
 * two-hand floor. `posted_at` is when the post opened — a re-post is a new row,
 * so it starts a fresh clock.
 *
 * ONE clock: the cutoff is the sweep's own `now`, the same instant its
 * `expires_at` arm compares against, so a hand cannot be judged by two clocks
 * in one statement. Both sides are compared as `timestamptz`, because the two
 * columns are written differently. `expires_at` is written by app code as a
 * UTC wall-clock; `posted_at` is only ever written by its `DEFAULT now()`,
 * which stores the DB session's LOCAL wall-clock in a naive `timestamp`.
 * Casting `posted_at` reads it back in that same session zone, and the cutoff
 * goes in as an explicit-`Z` ISO string, so the comparison holds on a DB whose
 * `TimeZone` is not UTC. A plain `posted_at <= $cutoff` would be off by the
 * zone's offset there.
 *
 * @param now - The sweep's clock.
 * @returns A subquery selecting `game_id`.
 */
export function agedBoardPostGameIds(now: Date) {
  return new QueryBuilder()
    .select({ gameId: posts.gameId })
    .from(posts)
    .where(
      and(
        eq(posts.state, 'open'),
        eq(posts.postKind, 'forum'),
        sql`${posts.postedAt}::timestamptz <= ${computePostAgeCutoff(now).toISOString()}::timestamptz`,
      ),
    );
}
