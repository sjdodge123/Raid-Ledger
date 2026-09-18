/**
 * Which horizon a GROUP is on, read live (ROK-1455 walk feedback).
 *
 * The horizon is a property of the group, never of one member: a group is a
 * `now` group while ANY live member holds a `now` hand, a `tonight` group when
 * no now-hand is live but a tonight-hand is, and a `week` group otherwise. An
 * inviter on a week hand can therefore invite you into a group that is playing
 * right now, and the DM has to say so.
 *
 * ROK-1616 — the order is strict: **now > tonight > week**, most urgent wins.
 * A MIXED group (someone on `now`, someone else on `tonight`) is a `now`
 * group: the group IS playing right now, and describing it as "tonight" would
 * send a joiner away for six hours from people already in voice. The reverse
 * never happens — a tonight-hand cannot mask a live now-hand, because the
 * now-hand is looked for FIRST and short-circuits.
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
  /**
   * When the longest-running hand on the group's own horizon lapses; null on a
   * week group. On a `tonight` group this is that group's 04:00.
   */
  nowExpiresAt: Date | null;
  /**
   * That hand's TTL bucket — what a joiner inherits; null on a week group AND
   * on a tonight group, which has no TTL at all (its clock is an absolute
   * wall-clock instant, and `ttl_minutes` is a `now`-only column).
   */
  ttlMinutes: LfgNowTtl | null;
}

/** The week answer, shared so no caller re-spells it. */
const WEEK_HORIZON: LfgGroupHorizon = {
  urgency: 'week',
  nowExpiresAt: null,
  ttlMinutes: null,
};

/** One live hand on a given horizon: the longest-running one, or undefined. */
interface LiveHand {
  expiresAt: Date;
  ttlMinutes: number | null;
}

/**
 * The longest-running LIVE hand a group holds on ONE urgency class.
 *
 * `liveIntent` is the shared "counts right now" predicate, so a lapsed or
 * ineligible holder's hand can never make the group look urgent. It requires
 * `users` to be joined — hence the inner join.
 *
 * Longest-running, not soonest: that is when the group stops being a group of
 * this class, so it is the honest "until".
 *
 * @param db - Drizzle handle (or a transaction).
 * @param gameId - Game whose group to read.
 * @param urgency - The stored class to look for. Matched EXACTLY — this is
 *   what makes AC7 hold on the read side: no row is ever reinterpreted.
 * @param now - Instant to measure expiry against.
 */
async function findLiveHand(
  db: LfgDb,
  gameId: number,
  urgency: LfgUrgency,
  now: Date,
): Promise<LiveHand | undefined> {
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
        eq(schema.lfgIntents.urgency, urgency),
        liveIntent(now),
      ),
    )
    .orderBy(desc(schema.lfgIntents.expiresAt))
    .limit(1);
  return row as LiveHand | undefined;
}

/**
 * Read a group's current horizon: now > tonight > week (ROK-1616 AC6).
 *
 * Two indexed lookups at worst, and the `now` one short-circuits — which is
 * not just an optimisation, it is the precedence rule itself: a group with
 * both a now-hand and a tonight-hand never reaches the tonight query, so a
 * MIXED group is always a `now` group.
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
  const nowHand = await findLiveHand(db, gameId, 'now', now);
  if (nowHand) {
    return {
      urgency: 'now',
      nowExpiresAt: nowHand.expiresAt,
      // The DB CHECK allows a null TTL on any row, so a malformed `now` row
      // falls into the default bucket rather than reporting no clock at all.
      ttlMinutes:
        (nowHand.ttlMinutes as LfgNowTtl | null) ?? LFG_DEFAULT_NOW_TTL_MINUTES,
    };
  }
  const tonightHand = await findLiveHand(db, gameId, 'tonight', now);
  if (!tonightHand) return WEEK_HORIZON;
  // `ttlMinutes` stays null even if the stored row somehow carries one: a
  // tonight group has no TTL bucket, and reporting one would hand a joiner a
  // 30-minute clock on a six-hour group.
  return {
    urgency: 'tonight',
    nowExpiresAt: tonightHand.expiresAt,
    ttlMinutes: null,
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
  if (horizon.urgency === 'now') {
    return {
      urgency: 'now',
      ttlMinutes: horizon.ttlMinutes ?? LFG_DEFAULT_NOW_TTL_MINUTES,
    };
  }
  // No `expiresAt` is copied from the group: `resolveIntentHorizon` recomputes
  // 04:00 from the JOIN instant. The two agree on any normal join, and where
  // they disagree — a joiner in a different zone, or a group whose 04:00 has
  // slipped past — recomputing is the answer that cannot write an expiry in
  // the past.
  if (horizon.urgency === 'tonight') return { urgency: 'tonight' };
  return { urgency: 'week' };
}
