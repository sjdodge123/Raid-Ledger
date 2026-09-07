/**
 * Urgency-aware writes for LFG intents (ROK-1479).
 *
 * Split out of `lfg-write.helpers.ts` — pre-declared in the spec's Lane A
 * table — because adding the bump and the per-row refresh pushed that file
 * past its 240-line budget.
 *
 * Both functions here are the write side of the operator's **A3 ruling**: a +1
 * refreshes every live member of the group, but each on its OWN horizon. A
 * `week` row goes to +14 days, exactly as it did before this story; a `now`
 * row goes to +its own TTL, never to 14 days. That is the whole feature — the
 * moment one blanket UPDATE writes 14 days across the group, a "right now"
 * intent silently becomes a weekly one.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import {
  liveGroupRow,
  resolveIntentHorizon,
  type LfgIntentRow,
  type LfgUrgencyRequest,
} from './lfg-write.helpers';
import {
  LFG_DEFAULT_NOW_TTL_MINUTES,
  LFG_NOW_TTL_MINUTES,
  computeExpiresAt,
  computeNowExpiresAt,
} from './lfg.constants';

/**
 * Re-heart an intent the caller already holds onto a different clock (AC2).
 *
 * ONE `UPDATE`, guarded by `status = 'active'`, against the row the partial
 * unique index already guarantees is the only live one for this (user, game) —
 * so a bump can never produce a second row. When another request converted the
 * row a moment earlier the UPDATE simply matches nothing: no throw and no
 * retry, because under postgres.js a failed statement would poison the whole
 * surrounding advisory-lock transaction.
 *
 * Applied only when the class actually changes, OR when the request is `now` —
 * re-picking "Right now" is how a player restarts their own countdown, so it
 * has to be a write even though the class is unchanged. Re-picking "this week"
 * on a week row is a genuine no-op and must not touch anyone's clock.
 *
 * @param db - The TRANSACTION handle holding the group's advisory lock.
 * @param row - The caller's surviving active row.
 * @param opts - The class the caller just asked for.
 * @returns The updated row, or null when nothing was applied (no-op, or the
 *   guarded UPDATE matched no active row — the caller keeps `row`).
 */
export async function bumpIntentUrgency(
  db: LfgDb,
  row: LfgIntentRow,
  opts: LfgUrgencyRequest,
): Promise<LfgIntentRow | null> {
  if (opts.urgency === row.urgency && opts.urgency !== 'now') return null;
  const [updated] = await db
    .update(schema.lfgIntents)
    .set(resolveIntentHorizon(opts))
    .where(
      and(
        eq(schema.lfgIntents.id, row.id),
        eq(schema.lfgIntents.status, 'active'),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * Which live `now` rows belong to one TTL bucket.
 *
 * The DB CHECK allows `ttl_minutes IS NULL` on any row, so a malformed `now`
 * row would otherwise be refreshed by nobody and lapse early. It falls into
 * the default (30-minute) bucket instead.
 *
 * @param ttlMinutes - The bucket's TTL, one of {@link LFG_NOW_TTL_MINUTES}.
 */
function nowTtlBucket(ttlMinutes: number) {
  const matches = eq(schema.lfgIntents.ttlMinutes, ttlMinutes);
  return ttlMinutes === LFG_DEFAULT_NOW_TTL_MINUTES
    ? or(matches, isNull(schema.lfgIntents.ttlMinutes))
    : matches;
}

/**
 * The +1 refresh (ROK-1451 AC5, re-cut for A3): push `expires_at` out for
 * every LIVE intent on the game, each by its own class's horizon.
 *
 * Eligibility stays the read-side predicate (`liveGroupRow`), not just
 * `status = 'active'`: a lapsed-but-unswept row, or a departed holder's row,
 * must not be pushed forward — that re-raises a hand the player never raised.
 *
 * Issued as one statement per horizon (week, then one per entry of
 * {@link LFG_NOW_TTL_MINUTES}) rather than a single `CASE`, because the TTL
 * domain is a closed two-value set pinned by the DB CHECK, and JS-computed
 * `Date`s go through Drizzle's own column mapper — the same path every other
 * `expires_at` write in this module already takes. A `CASE` would have to do
 * the arithmetic in SQL against a `timestamp` (no zone) column, which is
 * exactly where a session-timezone bug would hide. All three run inside the
 * caller's advisory-lock transaction, so they land atomically.
 *
 * Writes `expires_at` and NOTHING else: a +1 moves other people's clocks, it
 * never changes what class they asked for.
 *
 * @param db - The TRANSACTION handle holding the group's advisory lock.
 * @param gameId - Game whose group clock resets.
 */
export async function refreshGroupExpiry(
  db: LfgDb,
  gameId: number,
): Promise<void> {
  const now = new Date();
  await db
    .update(schema.lfgIntents)
    .set({ expiresAt: computeExpiresAt(now) })
    .where(
      and(liveGroupRow(db, gameId, now), eq(schema.lfgIntents.urgency, 'week')),
    );
  for (const ttlMinutes of LFG_NOW_TTL_MINUTES) {
    await db
      .update(schema.lfgIntents)
      .set({ expiresAt: computeNowExpiresAt(ttlMinutes, now) })
      .where(
        and(
          liveGroupRow(db, gameId, now),
          eq(schema.lfgIntents.urgency, 'now'),
          nowTtlBucket(ttlMinutes),
        ),
      );
  }
}
