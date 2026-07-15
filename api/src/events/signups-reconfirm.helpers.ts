/**
 * Shared pending→confirmed self-heal for explicit attendance re-assertions
 * (ROK-1379 follow-up). After the ROK-1269 reschedule reset flips signups to
 * confirmationStatus 'pending', a characterless-game attendee has no confirm
 * affordance except re-asserting their signup (Discord Sign Up re-click or a
 * duplicate signup POST). This heals that state, but only when the signup
 * holds a real (non-bench) roster slot — matching the assignDirectSlot rule
 * that a non-bench grant confirms the signup, so benched players are not
 * silently promoted to confirmed.
 *
 * Callers are responsible for the ROK-1269 `signup_reconfirmed` audit-log
 * write when this returns true (the write must fire post-commit for the
 * transactional web path, so it cannot live here).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SignupResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import { getAssignedSlotRole } from './signups-roster-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ActivityLogger = Pick<ActivityLogService, 'log'>;

/** Shape of the duplicate-signup branch returned by signupTxBody. */
export interface DuplicateSignupResult {
  reconfirmed?: boolean;
  reconfirmedUserId?: number | null;
  response: SignupResponseDto;
}

/**
 * Emit the ROK-1269 `signup_reconfirmed` audit entry for a pending→confirmed
 * re-assertion (Discord Sign Up re-click or a duplicate signup POST). Keeps
 * both heal call-sites within their file-size budgets and the reason strings
 * in one place.
 */
export function logSignupReconfirmed(
  activityLog: ActivityLogger,
  eventId: number,
  userId: number,
  reason: string,
): Promise<void> {
  return activityLog.log('event', eventId, 'signup_reconfirmed', userId, {
    reason,
  });
}

/**
 * Post-commit finalize for a duplicate signup: emit the reconfirm audit entry
 * when the self-heal fired, then return the response. Extracted so the service
 * `signup` path stays within its size budget.
 */
export async function finalizeDuplicate(
  activityLog: ActivityLogger,
  eventId: number,
  result: DuplicateSignupResult,
): Promise<SignupResponseDto> {
  if (result.reconfirmed && result.reconfirmedUserId != null)
    await logSignupReconfirmed(
      activityLog,
      eventId,
      result.reconfirmedUserId,
      'signup-reassert',
    );
  return result.response;
}

/**
 * Confirms a pending signup that holds a non-bench slot. Returns true iff the
 * confirmationStatus was actually flipped pending→confirmed.
 */
export async function reconfirmPendingWithSlot(
  db: Db,
  signupId: number,
  confirmationStatus: string,
): Promise<boolean> {
  if (confirmationStatus !== 'pending') return false;
  const role = await getAssignedSlotRole(db, signupId);
  if (!role || role === 'bench') return false;
  await db
    .update(schema.eventSignups)
    .set({ confirmationStatus: 'confirmed' })
    .where(eq(schema.eventSignups.id, signupId));
  return true;
}

/** Minimal signup shape for the Discord Sign Up re-click heal. */
export interface DiscordReassertSignup {
  id: number;
  eventId: number;
  confirmationStatus: string;
  user: { id: number };
}

/**
 * Discord Sign Up re-click self-heal: reconfirm a pending, non-bench signup
 * and emit the ROK-1269 audit entry. Returns true iff it healed.
 */
export async function healPendingFromDiscord(
  db: Db,
  activityLog: ActivityLogger,
  signup: DiscordReassertSignup,
): Promise<boolean> {
  const healed = await reconfirmPendingWithSlot(
    db,
    signup.id,
    signup.confirmationStatus,
  );
  if (healed)
    await logSignupReconfirmed(
      activityLog,
      signup.eventId,
      signup.user.id,
      'discord-signup-reassert',
    );
  return healed;
}
