/**
 * Late-joiner catch-up derivation for the scheduling poll (ROK-1545 AC5).
 *
 * A member who is added to a poll after voting has already started lands on a
 * board mid-argument: some times already carry votes and nothing tells them
 * how far along the poll is (audit F-05 / P-6). `deriveCatchUp` answers "am I
 * behind?" from the member rows alone — `joinedAt` (ROK-1545 contract field)
 * against the earliest `schedulingSubmittedAt` on the poll.
 *
 * Both helpers are pure so the composite can call them during render and the
 * unit tests can pin the semantics without a DOM.
 */
import { formatDistanceToNow } from 'date-fns';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';

/** One enrolled poll member, as the poll page response carries it. */
export type SchedulingPollMember = MatchDetailResponseDto['members'][number];

/** What a late joiner needs to catch up: how far the poll has already got. */
export interface SchedulingCatchUp {
  /** Members who have cast at least one vote. */
  votersSoFar: number;
  /** Total enrolled members (the denominator). */
  memberCount: number;
}

/** Members who are enrolled but have not voted yet. */
export function pendingVoters(
  members: readonly SchedulingPollMember[],
): SchedulingPollMember[] {
  return members.filter((m) => m.schedulingSubmittedAt === null);
}

/** Earliest vote timestamp on the poll, or null when nobody has voted. */
function firstVoteAt(members: readonly SchedulingPollMember[]): string | null {
  const stamps = members
    .map((m) => m.schedulingSubmittedAt)
    .filter((s): s is string => s !== null)
    .sort();
  return stamps[0] ?? null;
}

/**
 * Catch-up state for the viewer, or null when there is nothing to catch up on:
 * they are not a member, they have already voted, no vote has been cast yet,
 * or they were enrolled before the first vote (a founding member is not late).
 */
export function deriveCatchUp(
  members: readonly SchedulingPollMember[],
  viewerId: number | null,
): SchedulingCatchUp | null {
  if (viewerId === null) return null;
  const me = members.find((m) => m.userId === viewerId);
  if (!me || me.schedulingSubmittedAt !== null) return null;
  const firstVote = firstVoteAt(members);
  if (firstVote === null || me.joinedAt <= firstVote) return null;
  return {
    votersSoFar: members.length - pendingVoters(members).length,
    memberCount: members.length,
  };
}

/**
 * Relative deadline copy for the catch-up line ("closes in 2 days"), or null
 * when the poll has no deadline or it has already passed — a late joiner is
 * told how long is left, not that the clock ran out (that is the terminal
 * banner's job).
 */
export function formatDeadlineLabel(
  phaseDeadline: string | null | undefined,
): string | null {
  if (!phaseDeadline) return null;
  const date = new Date(phaseDeadline);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  return `closes in ${formatDistanceToNow(date)}`;
}
