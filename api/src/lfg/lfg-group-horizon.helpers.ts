/**
 * Which horizon a GROUP is on, read live (ROK-1455 walk feedback).
 *
 * The horizon is a property of the group, never of one member: a group is a
 * `now` group while ANY live member holds a `now` hand, and a `week` group
 * otherwise. An inviter on a week hand can therefore invite you into a group
 * that is playing right now, and the DM has to say so.
 *
 * Read at BOTH ends and never cached into a custom id:
 *  - at send time, so the DM quotes the horizon it was actually sent on;
 *  - at PRESS time, so a DM opened an hour later raises the hand the group is
 *    on *then*. Baking `now` into the button would raise a now-hand on a group
 *    whose now-hands have all lapsed.
 *
 * The row it reports is the live `now` hand that runs LONGEST — that is when
 * the group stops being a now group, so it is the honest "until", and its TTL
 * bucket is the clock a joiner inherits (the same bucket `refreshGroupExpiry`
 * pushes every live now hand out on).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { LfgNowTtl, LfgUrgency } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { liveIntent, type LfgDb } from './lfg-query.helpers';
import type { LfgUrgencyRequest } from './lfg-write.helpers';
import { LFG_DEFAULT_NOW_TTL_MINUTES } from './lfg.constants';

/** What horizon a group is on right now. */
export interface LfgGroupHorizon {
  urgency: LfgUrgency;
  /** When the longest-running live `now` hand lapses; null on a week group. */
  nowExpiresAt: Date | null;
  /** That hand's TTL bucket — what a joiner inherits; null on a week group. */
  ttlMinutes: LfgNowTtl | null;
}

/** The week answer, shared so no caller re-spells it. */
const WEEK_HORIZON: LfgGroupHorizon = {
  urgency: 'week',
  nowExpiresAt: null,
  ttlMinutes: null,
};

/**
 * Read a group's current horizon.
 *
 * `liveIntent` is the shared "counts right now" predicate, so a lapsed or
 * ineligible holder's `now` hand can never make the group look urgent. It
 * requires `users` to be joined — hence the inner join.
 *
 * @param db - Drizzle handle (or a transaction).
 * @param gameId - Game whose group to read.
 * @param now - Instant to measure expiry against.
 */
export async function readGroupHorizon(
  db: LfgDb,
  gameId: number,
  now: Date = new Date(),
): Promise<LfgGroupHorizon> {
  const [row] = await db
    .select({
      expiresAt: schema.lfgIntents.expiresAt,
      ttlMinutes: schema.lfgIntents.ttlMinutes,
    })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.urgency, 'now'),
        liveIntent(now),
      ),
    )
    .orderBy(desc(schema.lfgIntents.expiresAt))
    .limit(1);
  if (!row) return WEEK_HORIZON;
  return {
    urgency: 'now',
    nowExpiresAt: row.expiresAt,
    // The DB CHECK allows a null TTL on any row, so a malformed `now` row
    // falls into the default bucket rather than reporting no clock at all.
    ttlMinutes:
      (row.ttlMinutes as LfgNowTtl | null) ?? LFG_DEFAULT_NOW_TTL_MINUTES,
  };
}

/**
 * The `createIntent` argument that matches a group's horizon.
 *
 * @param horizon - What {@link readGroupHorizon} just reported.
 */
export function horizonJoinRequest(
  horizon: LfgGroupHorizon,
): LfgUrgencyRequest {
  return horizon.urgency === 'now'
    ? {
        urgency: 'now',
        ttlMinutes: horizon.ttlMinutes ?? LFG_DEFAULT_NOW_TTL_MINUTES,
      }
    : { urgency: 'week' };
}
