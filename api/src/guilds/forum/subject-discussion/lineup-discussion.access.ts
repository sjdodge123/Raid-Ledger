/**
 * ROK-2272 S7b (R7) — who may do what in a hub-tagged community lineup's
 * thread (pure; no DB). Read = hub member/staff or a participant (has
 * nominated or voted in the lineup). Reply = a participant only, and only
 * while the thread is open. Moderate = hub Leader/Officer/staff. A private,
 * hub-less or standalone-carrier lineup never has a thread (layer 1), so it
 * is 404 before this runs.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { HubForumLock } from '@raid-ledger/contract';
import {
  FORUM_NOT_LINEUP_PARTICIPANT,
  FORUM_THREAD_READ_ONLY,
  type EventThreadActor,
} from '../event-discussion/event-discussion.access';
import {
  pollThreadLock,
  type PollThreadLockRow,
} from './poll-discussion.access';

/** R7: reply without a nomination or vote (defined beside the event copy). */
export { FORUM_NOT_LINEUP_PARTICIPANT };

/** What the service resolved about the viewer for one lineup thread. */
export interface LineupThreadFacts {
  /** `access.canView` on the thread's hub (members + staff). */
  isMember: boolean;
  /** `access.canEdit` on the thread's hub (Leader/Officer + staff). */
  canModerate: boolean;
  /** Nominated an entry of the ATTACHED lineup (`nominated_by`). */
  hasNominated: boolean;
  /** Has a vote row on the ATTACHED lineup. */
  hasVoted: boolean;
}

/** R7 matrix → actor (same shape as the event / poll thread actor). */
export function lineupThreadActor(
  userId: number,
  facts: LineupThreadFacts,
): EventThreadActor {
  const participant = facts.hasNominated || facts.hasVoted;
  return {
    userId,
    canRead: facts.isMember || participant,
    canReply: participant,
    canWrite: facts.isMember || participant,
    canModerate: facts.isMember && facts.canModerate,
  };
}

/**
 * Read-only state of a lineup thread, or null while writable: detached
 * first, then the close deadline (decided/archived + 1 h, layer 1). Same
 * rule and reasons as the poll thread (R8 reuses the event columns).
 */
export function lineupThreadLock(
  row: PollThreadLockRow,
  now: Date,
): HubForumLock | null {
  return pollThreadLock(row, now);
}

/** Reply gate: 409 once read-only (for everyone), else 403 for a non-participant. */
export function assertCanReplyToLineup(
  canReply: boolean,
  lock: HubForumLock | null,
): void {
  if (lock !== null) throw new ConflictException(FORUM_THREAD_READ_ONLY);
  if (!canReply) throw new ForbiddenException(FORUM_NOT_LINEUP_PARTICIPANT);
}
