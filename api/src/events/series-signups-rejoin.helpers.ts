/**
 * Re-join after leave (ROK-1728 Q6): signs the user up again on the nights
 * their last leave declined. Unlike a "create" night, the row already exists,
 * so `SignupsService.signup` reactivating it (ROK-1769) is the intent here.
 */
import type { JoinSeriesDto } from '@raid-ledger/contract';
import type { SignupsService } from './signups.service';
import type { Tx } from './signups.service.types';
import { findUserRowsForEvents, tagSignup } from './series-signups.queries';
import {
  ACTIVE_SIGNUP_STATUSES,
  type ClassifiedNights,
  type UserSeriesRow,
} from './series-signups-plan.helpers';
import {
  materializeNights,
  SERIES_ERRORS,
  type MaterializeMembership,
  type MaterializeResult,
} from './series-signups-join.helpers';

interface ReviveDeps {
  db: Tx;
  signups: Pick<SignupsService, 'signup'>;
}

function isActiveStatus(status: string): boolean {
  return ACTIVE_SIGNUP_STATUSES.some((s) => s === status);
}

/**
 * One revived night. The row must still be the inactive, untagged row the
 * plan read; anything else changed under the join and is reported, not
 * overwritten. Returns the failure message, or `null` on success.
 */
async function reviveOne(
  deps: ReviveDeps,
  planned: UserSeriesRow,
  userId: number,
  membership: MaterializeMembership,
  dto: JoinSeriesDto,
): Promise<string | null> {
  const [current] = await findUserRowsForEvents(deps.db, userId, [
    planned.eventId,
  ]);
  const unchanged =
    current?.id === planned.id &&
    current.status === planned.status &&
    current.seriesSignupId === null;
  if (!unchanged) return SERIES_ERRORS.CHANGED;
  const signup = await deps.signups.signup(planned.eventId, userId, dto);
  if (signup.id !== planned.id || !isActiveStatus(signup.status))
    return SERIES_ERRORS.CHANGED;
  const tagged = await tagSignup(deps.db, signup.id, membership.id);
  return tagged ? null : SERIES_ERRORS.CHANGED;
}

/** Signs up again on every revivable night, best-effort per night (D5). */
export async function reviveNights(
  deps: ReviveDeps,
  rows: UserSeriesRow[],
  userId: number,
  membership: MaterializeMembership,
  dto: JoinSeriesDto,
): Promise<MaterializeResult> {
  const out: MaterializeResult = { createdEventIds: [], failed: [] };
  for (const row of rows) {
    try {
      const failure = await reviveOne(deps, row, userId, membership, dto);
      if (failure === null) out.createdEventIds.push(row.eventId);
      else out.failed.push({ eventId: row.eventId, message: failure });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      out.failed.push({ eventId: row.eventId, message });
    }
  }
  return out;
}

/**
 * Creates the missing nights (`create`), then signs up again on the nights
 * the user's last leave declined (`revive`); one merged result.
 */
export async function createAndReviveNights(
  deps: ReviveDeps,
  classified: Pick<ClassifiedNights, 'create' | 'revive'>,
  userId: number,
  membership: MaterializeMembership,
  dto: JoinSeriesDto,
): Promise<MaterializeResult> {
  const created = await materializeNights(
    deps,
    classified.create,
    userId,
    membership,
    dto,
  );
  const revived = await reviveNights(
    deps,
    classified.revive,
    userId,
    membership,
    dto,
  );
  return {
    createdEventIds: [...created.createdEventIds, ...revived.createdEventIds],
    failed: [...created.failed, ...revived.failed],
  };
}
