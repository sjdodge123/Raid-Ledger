/**
 * Series membership lifecycle (ROK-1728): leave cancellation and the
 * system ends — deactivation (AC5) and series delete / cancel (AC6, D6).
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { SeriesSignupEndedReason } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';
import type { SignupsService } from './signups.service';
import {
  clearFutureTagsForMemberships,
  countRemainingNights,
  endActiveMembershipsForGroup,
  endActiveMembershipsForUser,
  findTaggedFutureActiveSignups,
} from './series-signups.queries';
import { isLateCancel } from './series-signups-plan.helpers';

/** Outcome of cancelling a member's future nights on leave. */
export interface CancelledNights {
  cancelledEventIds: number[];
  lateCancelledEventIds: number[];
}

/** System end reasons applied by series delete / cancel. */
export type SeriesOpEndReason = Extract<
  SeriesSignupEndedReason,
  'series_deleted' | 'series_cancelled'
>;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

/**
 * Cancels every future ACTIVE night tagged by the membership through
 * `SignupsService.cancel` (23h rule + `signup_cancelled` log per night,
 * OQ-3). Best-effort per night.
 */
export async function cancelTaggedNights(
  deps: { db: Tx; signups: Pick<SignupsService, 'cancel'>; logger: Logger },
  membershipId: number,
  userId: number,
  now: Date,
): Promise<CancelledNights> {
  const out: CancelledNights = {
    cancelledEventIds: [],
    lateCancelledEventIds: [],
  };
  const rows = await findTaggedFutureActiveSignups(deps.db, membershipId, now);
  for (const row of rows) {
    try {
      await deps.signups.cancel(row.eventId, userId);
      out.cancelledEventIds.push(row.eventId);
      if (isLateCancel(row.startTime, now))
        out.lateCancelledEventIds.push(row.eventId);
    } catch (err: unknown) {
      deps.logger.warn(
        `ROK-1728: leave-series cancel of event ${row.eventId} failed: ${errMessage(err)}`,
      );
    }
  }
  return out;
}

/** AC5: ends every active membership of a deactivated user and untags. */
export async function endSeriesMembershipsForUser(
  db: Tx,
  userId: number,
): Promise<number[]> {
  const ids = await endActiveMembershipsForUser(db, userId, 'deactivated');
  await clearFutureTagsForMemberships(db, ids, new Date());
  return ids;
}

/** D6: ends the group's memberships only when no future night remains. */
export async function endMembershipsIfSeriesFinished(
  db: Tx,
  groupId: string,
  reason: SeriesOpEndReason,
): Promise<number[]> {
  const now = new Date();
  if ((await countRemainingNights(db, groupId, now)) > 0) return [];
  const ids = await endActiveMembershipsForGroup(db, groupId, reason);
  await clearFutureTagsForMemberships(db, ids, now);
  return ids;
}

/** The event's recurrence group, or null (also null on a failed read). */
export async function findRecurrenceGroupId(
  db: Tx,
  eventId: number,
  logger: Logger,
): Promise<string | null> {
  try {
    const [row] = await db
      .select({ groupId: schema.events.recurrenceGroupId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return row?.groupId ?? null;
  } catch (err: unknown) {
    logger.warn(
      `ROK-1728: group lookup for ${eventId} failed: ${errMessage(err)}`,
    );
    return null;
  }
}

/**
 * Best-effort hook after a series delete / cancel: the series op already
 * happened, so a membership-end failure is logged, never thrown.
 */
export async function endMembershipsAfterSeriesOp(
  db: Tx,
  groupId: string | null,
  reason: SeriesOpEndReason,
  logger: Logger,
): Promise<void> {
  if (!groupId) return;
  try {
    const ids = await endMembershipsIfSeriesFinished(db, groupId, reason);
    if (ids.length > 0)
      logger.log(
        `ROK-1728: ended ${ids.length} series membership(s) [${reason}]`,
      );
  } catch (err: unknown) {
    logger.warn(
      `ROK-1728: series membership end [${reason}] failed: ${errMessage(err)}`,
    );
  }
}
