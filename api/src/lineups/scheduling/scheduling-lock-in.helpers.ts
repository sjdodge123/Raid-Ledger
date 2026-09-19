/**
 * Finishing an EXPIRED scheduling poll (ROK-1610).
 *
 * A poll whose deadline passed without a lock-in used to be a dead end: the
 * page offered "start a new poll" and nothing else, even though the votes
 * already on record named a time that is still in the future. The organiser
 * may now lock that time in — the ordinary lock-in flow, just after the
 * deadline. Voting stays closed for everyone (that guard is untouched); this
 * is an organiser action, not a re-open.
 *
 * These helpers answer the three questions that lock-in asks, so the READ path
 * (what the page may offer) and the WRITE path (what the service accepts)
 * cannot disagree about any of them.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sortSchedulingSlots } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import type { SchedulingPollStatus } from '../../discord-bot/services/discord-embed-scheduling.types';
import { assertUserHasVoted } from './scheduling-event.helpers';
import {
  findLineupPollMeta,
  findScheduleVotes,
} from './scheduling-query.helpers';
import { assertPollLockable } from './scheduling-guard.helpers';
import {
  stanceTallyFor,
  tallyStancesBySlot,
} from './scheduling-stance.helpers';
import type { StanceVoteRef } from './scheduling-stance.helpers';

/** Slot fields the leader search needs. */
export interface LockInSlotRef {
  id: number;
  /**
   * Review fix: drizzle's `.select()` hands back a `Date`, but a raw
   * `db.execute` row and several fixtures carry the ISO string — the same
   * coercion `assertSlotIsFuture` does, rather than a `TypeError` on the
   * poll-page READ path.
   */
  proposedTime: Date | string;
}

/**
 * A vote row, reduced to the fields the leader search needs.
 *
 * ROK-1617: the stance rides along. Without it a `no` on a slot counted as a
 * vote FOR that slot and could lock in the time its voters just rejected.
 */
export type LockInVoteRef = StanceVoteRef;

/** The caller of a lock-in. */
export interface LockInCaller {
  id: number;
  role?: string | null;
}

/** The poll's parent lineup, for the organiser test. */
export interface LockInLineupRef {
  createdBy?: number | null;
}

/**
 * The slot an expired poll would be finished at: the leading slot among those
 * that are still in the FUTURE and have at least one vote.
 *
 * Past slots are never offered — the poll's own deadline passing does not make
 * a time that has already come and gone schedulable (AC2: when every slot has
 * passed this returns null and the page keeps the "start a new poll" copy).
 * Ordering is the shared `sortSchedulingSlots` comparator, so "leading" means
 * the same thing here as everywhere else the winner is named.
 *
 * @param slots - The poll's slots.
 * @param votes - Vote rows across those slots.
 * @param now - Injectable clock for tests.
 * @returns The slot id, or null when no future slot has a vote.
 */
export function findLeadingLockableSlot(
  slots: LockInSlotRef[],
  votes: LockInVoteRef[],
  now: Date = new Date(),
): number | null {
  const tallies = tallyStancesBySlot(votes);
  const candidates = slots
    .map((s) => ({ id: s.id, at: new Date(s.proposedTime) }))
    .filter((s) => !Number.isNaN(s.at.getTime()) && s.at > now)
    .map((s) => ({
      id: s.id,
      proposedTime: s.at.toISOString(),
      ...stanceTallyFor(tallies, s.id),
    }))
    // At least one YES: a slot carrying only `no`s is not lockable, however
    // its net score compares (ROK-1617).
    .filter((s) => s.voteCount > 0);
  const [leader] = sortSchedulingSlots(candidates);
  return leader?.id ?? null;
}

/** The poll's organiser: its lineup's creator, an admin, or an operator. */
export function isPollOrganiser(
  lineup: LockInLineupRef | undefined,
  caller: LockInCaller,
): boolean {
  if (caller.role === 'admin' || caller.role === 'operator') return true;
  return !!lineup && lineup.createdBy === caller.id;
}

/**
 * Refuse a post-deadline lock-in by anyone but the organiser (AC3).
 *
 * Before the deadline the gate is unchanged — any member who voted may lock a
 * time in. After it, finishing the poll is an organiser decision: an ordinary
 * member sees the expired state and no action.
 *
 * @throws ForbiddenException when the caller is not the organiser.
 */
export function assertCallerMayLockIn(
  lineup: LockInLineupRef | undefined,
  caller: LockInCaller,
): void {
  if (isPollOrganiser(lineup, caller)) return;
  throw new ForbiddenException(
    'Only an organiser can schedule a time from an expired poll',
  );
}

/**
 * ROK-1607: a time in the past cannot be VOTED for. Mirrors the suggest
 * guard, and takes the row the caller already loaded so voting stays one read.
 *
 * Review fix: this gates ADDING a vote only — `toggleVote` runs it after the
 * insert-or-delete has told it which of the two happened, so a member can
 * still WITHDRAW a vote from a time that has since passed.
 *
 * @throws BadRequestException when the slot's time has passed.
 */
export function assertSlotStillVotable(
  proposedTime: Date | string | null | undefined,
  now: Date = new Date(),
): void {
  const at = proposedTime == null ? null : new Date(proposedTime);
  if (at === null || Number.isNaN(at.getTime())) return;
  if (at.getTime() <= now.getTime()) {
    throw new BadRequestException(
      'That time has already passed — suggest a new time instead',
    );
  }
}

/**
 * Refuse a lock-in on a time that has already passed, expired poll or not.
 *
 * @throws BadRequestException when `proposedTime` is in the past.
 */
export function assertSlotIsFuture(
  proposedTime: Date | string | null | undefined,
  now: Date = new Date(),
): void {
  // postgres-js hands back a Date, but raw `db.execute` rows and several unit
  // fixtures carry the ISO string — coerce rather than throw a TypeError.
  const at = proposedTime == null ? null : new Date(proposedTime);
  if (at === null || Number.isNaN(at.getTime())) return;
  if (at.getTime() <= now.getTime()) {
    throw new BadRequestException('That time has already passed');
  }
}

/** What the poll page tells the client about the post-expiry action. */
export interface LockInPageState {
  canLockIn: boolean;
  lockInSlotId: number | null;
}

/**
 * Derive the page's post-expiry lock-in affordance.
 *
 * Only an EXPIRED poll gets these: an open poll already offers per-slot
 * lock-in, and a cancelled or locked-in poll is done. The slot id is exposed
 * whoever is looking (the banner can name the time); `canLockIn` is the
 * organiser-only permission to act on it.
 *
 * @param input - Poll status, parent lineup, viewer, slots and votes.
 * @returns `canLockIn` + `lockInSlotId` for the poll page response.
 */
export function resolveLockInPageState(input: {
  pollStatus: SchedulingPollStatus;
  lineup: LockInLineupRef | undefined;
  caller: LockInCaller | null;
  slots: LockInSlotRef[];
  votes: LockInVoteRef[];
  now?: Date;
}): LockInPageState {
  if (input.pollStatus !== 'closed') {
    return { canLockIn: false, lockInSlotId: null };
  }
  const lockInSlotId = findLeadingLockableSlot(
    input.slots,
    input.votes,
    input.now,
  );
  const canLockIn =
    lockInSlotId !== null &&
    !!input.caller &&
    isPollOrganiser(input.lineup, input.caller);
  return { canLockIn, lockInSlotId };
}

/**
 * Gate a lock-in: the whole guard cluster, in the order the service needs it.
 *
 * A slot that has already passed is refused whatever the poll's state. An
 * OPEN poll keeps the pre-existing "you must have voted" gate (unchanged
 * behaviour, any member). An EXPIRED one is an organiser decision (AC3).
 *
 * @param db - Drizzle database handle.
 * @param match - The match row being locked in.
 * @param matchId - The URL's match, so a body `slotId` from another poll —
 *   whose state was never checked — cannot be locked in.
 * @param slot - The slot row the caller named.
 * @param caller - The authenticated caller and their role.
 * @throws NotFoundException when the slot belongs to another match.
 * @throws BadRequestException when the poll is finished, the time passed, or
 *   an expired poll's slot has no votes.
 * @throws ForbiddenException when a non-organiser finishes an expired poll,
 *   or an open poll's caller has not voted.
 */
export async function assertMayLockInSlot(
  db: PostgresJsDatabase<typeof schema>,
  match: { status: string; lineupId: number; linkedEventId?: number | null },
  matchId: number,
  slot: { id: number; matchId: number; proposedTime: Date },
  caller: LockInCaller,
): Promise<void> {
  if (slot.matchId !== matchId) {
    throw new NotFoundException('Slot not found in this match');
  }
  const [lineup] = await findLineupPollMeta(db, match.lineupId);
  const pollStatus = assertPollLockable(match, lineup);
  assertSlotIsFuture(slot.proposedTime);
  if (pollStatus === 'open') {
    await assertUserHasVoted(db, matchId, caller.id);
    return;
  }
  assertCallerMayLockIn(lineup, caller);
  await assertSlotHasVoters(db, slot.id);
}

/**
 * Review fix (P2): an EXPIRED poll may only be finished at a slot somebody
 * actually voted for.
 *
 * The READ path never offers a vote-less slot (`findLeadingLockableSlot`
 * filters on `voteCount > 0`), but the WRITE path used to accept any future
 * slot from an organiser. Locking one in created an event whose auto-signup
 * list is EMPTY — nobody on the roster, the organiser included — and
 * announced it on Discord. Voting is closed at this point, so an empty slot
 * can never fill up afterwards; the only honest answer is to refuse it.
 *
 * The open-poll branch is untouched: there the caller must have voted
 * somewhere on the match, which is the pre-existing gate.
 *
 * @param db - Drizzle database handle.
 * @param slotId - The slot being locked in.
 * @throws BadRequestException when no vote points at the slot.
 */
export async function assertSlotHasVoters(
  db: PostgresJsDatabase<typeof schema>,
  slotId: number,
): Promise<void> {
  const votes = await findScheduleVotes(db, [slotId]);
  if (votes.length === 0) {
    throw new BadRequestException(
      'Nobody voted for that time — voting has closed, so start a new poll instead',
    );
  }
}
