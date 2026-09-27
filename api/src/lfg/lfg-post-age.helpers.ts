/**
 * ROK-1691 — the board post-age cap's selection.
 *
 * A pure query builder, not a query: the expiry sweep embeds it as the
 * `game_id IN (...)` arm of its ONE existing UPDATE, so an aged post's hands
 * lapse in the same statement, come back through the same RETURNING, and reach
 * the board through the same per-game `expired` emit as a natural lapse.
 */
import { and, eq, lte } from 'drizzle-orm';
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
        lte(posts.postedAt, computePostAgeCutoff(now)),
      ),
    );
}
