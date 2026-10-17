/**
 * Finishing an EXPIRED scheduling poll from the page (ROK-1610).
 *
 * The ordinary lock-in (`use-scheduling-lock`) refetches the poll and aborts
 * unless it is still open — correct there, useless here: this flow exists
 * precisely because the deadline passed. The server decides who may act
 * (`canLockIn`) and at which time (`lockInSlotId`, the leading FUTURE slot
 * with votes), so this hook only carries the confirm and the write.
 *
 * The write is the create-event-from-slot endpoint, the same one the open
 * poll's lock-in ends at, so the slot's voters are signed up, rostered and
 * given their Discord card by the path that already does that — and its
 * invalidation repaints the page into the locked-in terminal state.
 */
import { useState } from 'react';
import type {
  SchedulePollPageResponseDto,
  ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import { useCreateEventFromSlot } from '../../../hooks/use-scheduling';
import { toast } from '../../../lib/toast';
import { countDistinctVoters } from '../../../pages/scheduling/threshold';

/** Toast after the expired poll is finished. */
export const EXPIRED_LOCK_IN_SUCCESS =
  'Event scheduled — the members who picked this time are signed up';

export interface ExpiredLockIn {
  /** True when the viewer may finish this expired poll. */
  active: boolean;
  /** The slot the banner action schedules; null when there is no action. */
  slot: ScheduleSlotWithVotesDto | null;
  /** The slot awaiting confirmation; null while no modal is open. */
  pendingSlot: ScheduleSlotWithVotesDto | null;
  /** Distinct voters on the pending slot (confirm copy). */
  pendingDistinctVoters: number;
  /** Poll members, the denominator of the confirm copy. */
  memberCount: number;
  /** Open the confirm for a slot. */
  request: (slot: ScheduleSlotWithVotesDto) => void;
  /** Confirm — create the event at the pending slot. */
  confirm: () => void;
  /** Dismiss the confirm without scheduling. */
  cancel: () => void;
}

export interface UseExpiredLockInArgs {
  poll: SchedulePollPageResponseDto;
  lineupId: number;
  matchId: number;
}

/** Owns the post-expiry lock-in for a poll — see the file-level docstring. */
export function useExpiredLockIn(args: UseExpiredLockInArgs): ExpiredLockIn {
  const { poll, lineupId, matchId } = args;
  const createEvent = useCreateEventFromSlot();
  const [pendingSlot, setPendingSlot] =
    useState<ScheduleSlotWithVotesDto | null>(null);

  const active = poll.canLockIn === true && poll.lockInSlotId != null;
  const slot = active
    ? (poll.slots.find((s) => s.id === poll.lockInSlotId) ?? null)
    : null;

  const confirm = (): void => {
    const target = pendingSlot;
    setPendingSlot(null);
    if (!target) return;
    createEvent.mutate(
      { lineupId, matchId, slotId: target.id },
      {
        onSuccess: () => toast.success(EXPIRED_LOCK_IN_SUCCESS),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : 'Failed to schedule the event',
          ),
      },
    );
  };

  return {
    active,
    slot,
    pendingSlot,
    pendingDistinctVoters: pendingSlot ? countDistinctVoters(pendingSlot) : 0,
    memberCount: poll.match.members.length,
    request: setPendingSlot,
    confirm,
    cancel: () => setPendingSlot(null),
  };
}
