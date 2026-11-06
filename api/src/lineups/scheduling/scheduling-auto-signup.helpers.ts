/**
 * Auto-signup poll voters when an event is created from a schedule slot (ROK-1031).
 * Signs up each voter for the newly created event, skipping the creator
 * (who is already signed up via event creation).
 */
import type { SignupsService } from '../../events/signups.service';
import type { ScheduleVoteRow } from './scheduling-query.helpers';

/** Parameters for the auto-signup helper. */
export interface AutoSignupParams {
  eventId: number;
  /**
   * The user already signed up by the caller, skipped here. `null` when
   * nobody is (ROK-1606: the scheduling lock-in creates the event through
   * `EventsService.create`, which does NOT sign the creator up — skipping
   * them left the locking-in organiser off their own event's roster).
   */
  creatorId: number | null;
  /** Only `userId` is read, so an LFG member list fits too (ROK-1573). */
  voters: Pick<ScheduleVoteRow, 'userId'>[];
  signupsService: Pick<SignupsService, 'signup'>;
  /**
   * ROK-2025: the organizer's bench pick. When set, every other voter is
   * signed up first (vote order, no dto, as before), then each picked voter
   * explicitly onto the bench. An id that is not a voter, or is the creator,
   * is ignored: the caller has already validated the pick. Absent: signup
   * order alone decides, so the latest voters are auto-benched.
   */
  benchUserIds?: ReadonlySet<number>;
}

type SignupFn = Pick<SignupsService, 'signup'>;

/** Who landed on the bench and whose signup threw, in signup order. */
export interface AutoSignupResult {
  benchedUserIds: number[];
  /** Voters whose signup failed — NOT signed up, so never DM'd as such. */
  failedUserIds: number[];
}

/**
 * Auto-sign up poll voters for a newly created event.
 * Skips the event creator (already signed up) and deduplicates voters
 * who may appear multiple times across slots.
 * Individual signup failures are caught and swallowed so that one
 * failure does not prevent other voters from being signed up — a failed
 * signup is not counted as benched; it is reported in `failedUserIds` so a
 * caller never tells that voter they were signed up.
 * @param params - Auto-signup parameters
 * @returns the voters whose signup landed on the bench (ROK-1874), read from
 *   each signup's `assignedSlot`, and the voters whose signup threw, both in
 *   signup order
 */
export async function autoSignupSlotVoters(
  params: AutoSignupParams,
): Promise<AutoSignupResult> {
  const { eventId, creatorId, voters, signupsService } = params;
  const picked = params.benchUserIds ?? new Set<number>();
  const uniqueUserIds = [...new Set(voters.map((v) => v.userId))].filter(
    (uid) => uid !== creatorId,
  );
  const signupOrder = [
    ...uniqueUserIds.filter((uid) => !picked.has(uid)),
    ...uniqueUserIds.filter((uid) => picked.has(uid)),
  ];

  const result: AutoSignupResult = { benchedUserIds: [], failedUserIds: [] };
  for (const userId of signupOrder) {
    const toBench = picked.has(userId);
    const outcome = await signUpOne(signupsService, eventId, userId, toBench);
    if (outcome === 'bench') result.benchedUserIds.push(userId);
    if (outcome === 'failed') result.failedUserIds.push(userId);
  }
  return result;
}

/**
 * Sign one voter up: where the signup landed, or `failed`. A failure is
 * swallowed (one voter must not block the rest) and is not counted as benched.
 */
async function signUpOne(
  signupsService: SignupFn,
  eventId: number,
  userId: number,
  toBench: boolean,
): Promise<'bench' | 'roster' | 'failed'> {
  try {
    const result = toBench
      ? await signupsService.signup(eventId, userId, { slotRole: 'bench' })
      : await signupsService.signup(eventId, userId);
    return result.assignedSlot === 'bench' ? 'bench' : 'roster';
  } catch {
    return 'failed';
  }
}
