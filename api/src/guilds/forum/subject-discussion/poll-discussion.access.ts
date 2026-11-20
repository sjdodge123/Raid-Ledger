/**
 * ROK-2272 S7a (R7) — who may do what in a hub-tagged scheduling poll's
 * thread (pure; no DB). Read = hub member/staff, a voter or a match member
 * (mirrors events: the subject's participants read without hub membership).
 * Reply = a voter or a match member only, and only while the thread is open.
 * Moderate = hub Leader/Officer/staff. A private poll never has a thread
 * (the reconciler never creates one), so it is 404 before this runs.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { HubForumLock } from '@raid-ledger/contract';
import {
  FORUM_NOT_POLL_VOTER,
  FORUM_THREAD_READ_ONLY,
  type EventThreadActor,
} from '../event-discussion/event-discussion.access';

/** R7: reply without a vote / match membership (defined beside the event copy). */
export { FORUM_NOT_POLL_VOTER };

/** What the service resolved about the viewer for one poll thread. */
export interface PollThreadFacts {
  /** `access.canView` on the thread's hub (members + staff). */
  isMember: boolean;
  /** `access.canEdit` on the thread's hub (Leader/Officer + staff). */
  canModerate: boolean;
  /** Has a schedule vote on one of the ATTACHED poll's slots. */
  hasVoted: boolean;
  /** Has a `community_lineup_match_members` row on the ATTACHED poll. */
  isMatchMember: boolean;
}

/** R7 matrix → actor (same shape as the event thread actor). */
export function pollThreadActor(
  userId: number,
  facts: PollThreadFacts,
): EventThreadActor {
  const participant = facts.hasVoted || facts.isMatchMember;
  return {
    userId,
    canRead: facts.isMember || participant,
    canReply: participant,
    canWrite: facts.isMember || participant,
    canModerate: facts.isMember && facts.canModerate,
  };
}

/** The thread columns the poll read-only state is derived from. */
export interface PollThreadLockRow {
  eventDetachedAt: Date | null;
  writeClosesAt: Date | null;
}

/**
 * Read-only state of a poll thread, or null while writable. Detached (private
 * flip, hub untag) wins; then the close deadline (decided + 1 h, layer 1).
 * Reuses the existing `event-*` lock reasons — the contract has no poll ones.
 */
export function pollThreadLock(
  row: PollThreadLockRow,
  now: Date,
): HubForumLock | null {
  if (row.eventDetachedAt !== null) {
    return { at: row.eventDetachedAt.toISOString(), reason: 'event-detached' };
  }
  const closes = row.writeClosesAt;
  if (closes !== null && now.getTime() >= closes.getTime()) {
    return { at: closes.toISOString(), reason: 'event-ended' };
  }
  return null;
}

/** Reply gate: 409 once read-only (for everyone), else 403 without a vote. */
export function assertCanReplyToPoll(
  canReply: boolean,
  lock: HubForumLock | null,
): void {
  if (lock !== null) throw new ConflictException(FORUM_THREAD_READ_ONLY);
  if (!canReply) throw new ForbiddenException(FORUM_NOT_POLL_VOTER);
}
