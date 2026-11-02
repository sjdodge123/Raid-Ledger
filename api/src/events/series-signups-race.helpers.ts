/**
 * Join/leave race repair (ROK-1728, Codex P2).
 *
 * Join and leave cannot share a transaction or an advisory lock:
 * `SignupsService.signup` / `cancel` run on their own pooled connections and
 * are not tx-aware (D2: never edited), so a lock held on one connection while
 * they borrow others can starve the pool. Instead, `join()` re-reads the
 * membership AFTER every tag write has committed. Under READ COMMITTED:
 *
 * - re-read sees `active` → any leave ends the membership later, so its
 *   `findTaggedFutureActiveSignups` read sees every tag the join wrote and
 *   cancels them;
 * - re-read sees it ended → a leave ran mid-join and may have missed nights
 *   tagged after its read, so this module replays the leave tail for them.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';
import type { SignupsService } from './signups.service';
import { clearFutureTagsForMemberships } from './series-signups.queries';
import { cancelTaggedNights } from './series-signups-lifecycle.helpers';

/** Error copy for a join whose membership ended while it was filling. */
export const SERIES_RACE_ERRORS = {
  LEFT_DURING_JOIN: 'You left the series while this join was running',
} as const;

/** Dependencies of the leave-tail replay. */
export interface RaceRepairDeps {
  db: Tx;
  signups: Pick<SignupsService, 'cancel'>;
  logger: Logger;
}

/** True when the membership row is still `active` (fresh read). */
export async function isMembershipActive(
  db: Tx,
  membershipId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ status: schema.seriesSignups.status })
    .from(schema.seriesSignups)
    .where(eq(schema.seriesSignups.id, membershipId))
    .limit(1);
  return row?.status === 'active';
}

/**
 * After a join's fill: when the membership is no longer active, cancels the
 * future active nights still tagged to it and clears its future tags (the
 * same tail `leave()` runs). Returns true when the membership had ended.
 */
export async function undoFillIfMembershipEnded(
  deps: RaceRepairDeps,
  membershipId: number,
  userId: number,
): Promise<boolean> {
  if (await isMembershipActive(deps.db, membershipId)) return false;
  const now = new Date();
  await cancelTaggedNights(deps, membershipId, userId, now);
  await clearFutureTagsForMemberships(deps.db, [membershipId], now);
  deps.logger.warn(
    `ROK-1728: membership ${membershipId} ended during its join; nights released`,
  );
  return true;
}
