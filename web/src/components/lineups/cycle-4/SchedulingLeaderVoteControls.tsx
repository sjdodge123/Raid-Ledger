/**
 * The leading card's ballot binding (ROK-1617 follow-up, item B).
 *
 * The card stays presentational — it receives this as its `voteControls`
 * node, exactly the way ROK-1618 injects the `⋯` menu — so the composite
 * keeps owning the ballot (the ROK-1574 rule: ONE binding, spread into every
 * surface). Everything here is read off the SAME `useSchedulingLadder`
 * result the ladder rows render from, so a press on the card and a press on
 * the leading row are the same call with the same in-flight guard.
 *
 * Renders nothing — not a disabled control — when the server would refuse the
 * vote: a terminal poll, an anonymous/non-invitee viewer, or a leading time
 * that has already passed. Same gate as `SchedulingSlotRow`'s
 * `canVote && !isPast`.
 */
import type { JSX } from 'react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import type { SchedulingSlotListProps } from './SchedulingSlotList';
import { SchedulingVoteControls } from './SchedulingVoteControls';
import { formatSlotTime } from './scheduling-slot-time';

export interface SchedulingLeaderVoteControlsProps {
  /** The composite's single ballot binding (`useSchedulingLadder`). */
  ladder: SchedulingSlotListProps;
  /** The leading slot, or `null` when no time clears the leader floor. */
  slot: ScheduleSlotWithVotesDto | null;
}

/** Vote / "doesn't work" on the leading time — see file-level docstring. */
export function SchedulingLeaderVoteControls(
  props: SchedulingLeaderVoteControlsProps,
): JSX.Element | null {
  const { ladder, slot } = props;
  if (!slot || !ladder.canVote || ladder.readOnly) return null;
  const { label, isPast } = formatSlotTime(slot.proposedTime);
  if (isPast) return null;
  return (
    /*
      Its own full-width row inside the card, below the "N of M members picked
      this time" line — the `⋯` trigger keeps the top-right corner (ROK-1618
      AC7's 44px target is untouched). Below `sm` each button is `w-full` and
      they stack, so two ≥44px targets fit a 390px phone without overflowing;
      from `sm` up they sit side by side.
    */
    <div
      data-testid="scheduling-leader-actions"
      className="flex flex-wrap items-center gap-2 pt-1"
    >
      <SchedulingVoteControls
        label={label}
        voted={ladder.myVotedSlotIds.includes(slot.id)}
        noVoted={ladder.myNoSlotIds.includes(slot.id)}
        enrolByVoting={ladder.enrolByVoting}
        pending={(ladder.pendingSlotIds ?? []).includes(slot.id)}
        voteTestId="scheduling-leader-vote"
        noTestId="scheduling-leader-no"
        onToggleVote={() => ladder.onToggleVote(slot.id)}
        onToggleNo={() => ladder.onToggleNo(slot.id)}
      />
    </div>
  );
}
