/**
 * The poll's lifecycle (ROK-1545). The server derives `pollStatus` with the
 * same helper the Discord embed uses, so page and embed can never disagree;
 * the match-status fallback only covers a payload cached before that field
 * existed, and collapses every ending to "expired" — which is exactly what
 * the old single banner said.
 */
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import type { SchedulingPollStatus } from './SchedulingTerminalBanner';

/** Resolve the poll status, falling back to the match status. */
export function resolvePollStatus(
  poll: SchedulePollPageResponseDto,
): SchedulingPollStatus {
  if (poll.pollStatus) return poll.pollStatus;
  const open =
    poll.match.status === 'scheduling' || poll.match.status === 'suggested';
  return open ? 'open' : 'closed';
}
