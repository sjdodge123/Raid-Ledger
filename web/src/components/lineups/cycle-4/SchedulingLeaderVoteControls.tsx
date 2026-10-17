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
import { useState, type JSX } from 'react';
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

/**
 * The slot the card's controls answer, held steady across a press.
 *
 * Review finding (ROK-1617 follow-up): binding the card straight to the LIVE
 * leader lets an optimistic write move the buttons out from under the finger
 * that pressed them — a NO on the leading time drops it below the floor, so
 * mid-flight the same two buttons either re-target a DIFFERENT time (the next
 * press would then clear a slot the viewer never touched) or unmount
 * entirely. While the ladder still reports a press in flight on the bound
 * slot, the binding stays on THAT slot; it follows the live leader again as
 * soon as the press settles.
 *
 * The press id is recorded in the click handler and the binding is DERIVED
 * from it during render — a ref read in render is `react-hooks/refs` and the
 * catch-up in an effect is `react-hooks/set-state-in-effect`, so neither is
 * available. The recorded id stops mattering the moment the ladder drops it
 * from `pendingSlotIds`, which is also what releases the binding.
 *
 * @param ladder - The composite's ballot binding (`useSchedulingLadder`).
 * @param leadingSlot - The live leading slot, or `null` when none leads.
 * @returns The slot the controls answer (`null` when there is nothing to
 *          answer) and the press wrapper that records the pressed slot.
 */
function useCardBallotSlot(
  ladder: SchedulingSlotListProps,
  leadingSlot: ScheduleSlotWithVotesDto | null,
): {
  slot: ScheduleSlotWithVotesDto | null;
  press: (toggle: (slotId: number) => void, slotId: number) => void;
} {
  const [pressedId, setPressedId] = useState<number | null>(null);
  const pending = ladder.pendingSlotIds ?? [];
  const boundId =
    pressedId !== null && pending.includes(pressedId)
      ? pressedId
      : (leadingSlot?.id ?? null);
  return {
    slot: ladder.slots.find((s) => s.id === boundId) ?? null,
    press: (toggle, slotId) => {
      setPressedId(slotId);
      toggle(slotId);
    },
  };
}

/** Vote / "doesn't work" on the leading time — see file-level docstring. */
export function SchedulingLeaderVoteControls(
  props: SchedulingLeaderVoteControlsProps,
): JSX.Element | null {
  const { ladder } = props;
  const { slot, press } = useCardBallotSlot(ladder, props.slot);
  if (!slot || !ladder.canVote || ladder.readOnly) return null;
  const { label, isPast } = formatSlotTime(slot.proposedTime);
  if (isPast) return null;
  return (
    /*
      ONE row of two equal columns, LAST in the card (below the deadline
      banner). Two stacked full-width buttons would push the banner ~100px
      down and break `scheduling-poll.smoke.spec.ts`'s "the deadline is inside
      the 375×667 fold" assertion; side by side adds nothing above it. The
      grid stretches both cells to the row's `min-h-[44px]`, so each target
      clears 44px at every width, and at 375px each column is ~171px — wider
      than either label. `[&>button]:w-full` overrides the control's own
      `sm:w-auto`, which would otherwise shrink the desktop buttons off the
      column grid.
    */
    <div
      data-testid="scheduling-leader-actions"
      className="grid grid-cols-2 items-stretch gap-2 pt-2 min-h-[44px] [&>button]:w-full"
    >
      <SchedulingVoteControls
        label={label}
        voted={ladder.myVotedSlotIds.includes(slot.id)}
        noVoted={ladder.myNoSlotIds.includes(slot.id)}
        enrolByVoting={ladder.enrolByVoting}
        pending={(ladder.pendingSlotIds ?? []).includes(slot.id)}
        voteTestId="scheduling-leader-vote"
        noTestId="scheduling-leader-no"
        onToggleVote={() => press(ladder.onToggleVote, slot.id)}
        onToggleNo={() => press(ladder.onToggleNo, slot.id)}
      />
    </div>
  );
}
