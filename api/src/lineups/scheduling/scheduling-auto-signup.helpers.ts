/**
 * Auto-signup poll voters when an event is created from a schedule slot (ROK-1031).
 * Signs up each voter for the newly created event, skipping the creator
 * (who is already signed up via event creation).
 */
import { Logger } from '@nestjs/common';
import type { CreateSignupDto } from '@raid-ledger/contract';
import type { SignupsService } from '../../events/signups.service';
import type { ScheduleVoteRow } from './scheduling-query.helpers';

const logger = new Logger('AutoSignupSlotVoters');

/** ROK-2320: per-voter signup dto carried over from a follow-up's source event. */
export type SignupCarryover = ReadonlyMap<number, CreateSignupDto>;

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
  /**
   * ROK-2320: a follow-up poll's voters re-sign with the character + roles
   * of their source-event signup. Absent / no entry: today's no-dto signup.
   */
  carryover?: SignupCarryover | undefined;
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
    const carried = params.carryover?.get(userId);
    const outcome = await signUpOne(
      signupsService,
      { eventId, userId, toBench },
      carried,
    );
    if (outcome === 'bench') result.benchedUserIds.push(userId);
    if (outcome === 'failed') result.failedUserIds.push(userId);
  }
  return result;
}

/** Who to sign up where; `toBench` = the organizer's bench pick. */
interface SignupTarget {
  eventId: number;
  userId: number;
  toBench: boolean;
}

/**
 * Sign one voter up: where the signup landed, or `failed`. A failure is
 * swallowed (one voter must not block the rest) and is not counted as benched.
 */
async function signUpOne(
  signupsService: SignupFn,
  target: SignupTarget,
  carried: CreateSignupDto | undefined,
): Promise<'bench' | 'roster' | 'failed'> {
  try {
    const result = carried
      ? await signUpCarried(signupsService, target, carried)
      : await signUpPlain(signupsService, target);
    return result.assignedSlot === 'bench' ? 'bench' : 'roster';
  } catch {
    return 'failed';
  }
}

/** Today's signup: no dto, or the bench pick's `{ slotRole: 'bench' }`. */
function signUpPlain(signupsService: SignupFn, target: SignupTarget) {
  const { eventId, userId, toBench } = target;
  return toBench
    ? signupsService.signup(eventId, userId, { slotRole: 'bench' })
    : signupsService.signup(eventId, userId);
}

/**
 * ROK-2320: sign up with the carried character/roles (a bench pick keeps the
 * character only). A throw is logged and retried once as a plain signup, so a
 * stale carryover never drops a voter.
 */
async function signUpCarried(
  signupsService: SignupFn,
  target: SignupTarget,
  carried: CreateSignupDto,
) {
  const { eventId, userId, toBench } = target;
  const dto: CreateSignupDto = toBench
    ? {
        slotRole: 'bench',
        ...(carried.characterId ? { characterId: carried.characterId } : {}),
      }
    : carried;
  try {
    return await signupsService.signup(eventId, userId, dto);
  } catch (err: unknown) {
    logger.warn(
      `Carried signup failed for user ${userId} on event ${eventId}; retrying without carryover: ${String(err)}`,
    );
    return signUpPlain(signupsService, target);
  }
}
