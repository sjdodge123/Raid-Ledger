/**
 * Lock state machine for the ROK-1300 Scheduling composite.
 *
 * Lifts the per-slot "Lock this time →" logic out of the retired
 * `CreateEventSection` dropdown so it lives once, at composite level:
 *   - past-time guard (toast + abort),
 *   - majority-voter threshold → confirm modal for an early lock,
 *   - reschedule-vs-create branch: `linkedEventId != null` reschedules the
 *     linked event then `completeStandalonePoll(matchId, eventId, startTime)`
 *     so the backend auto-signs-up/re-rosters the slot's voters (ROK-1031);
 *     otherwise navigate to `/events/new?gameId&startTime&matchId` (verbatim
 *     target from `CreateFromSlot::performNavigate`), plus `copyFromEventId`
 *     when this is a follow-up poll so the create form prefills from the
 *     ended event instead of opening blank.
 *
 * ROK-1551 (AC4): `requestLock` never trusts the cached slot. It awaits a
 * fresh poll first and counts distinct voters from THAT response, so two
 * operators racing a stale page cannot both see "below majority" (§6).
 */
import { useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type {
  MatchDetailResponseDto,
  SchedulePollPageResponseDto,
  ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import { useRescheduleEvent } from '../../../hooks/use-reschedule';
import {
  completeStandalonePoll,
  getSchedulePoll,
} from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import {
  computeRequiredVoters,
  countDistinctVoters,
} from '../../../pages/scheduling/threshold';
import { resolvePollStatus } from './scheduling-poll-status';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Toast when the fresh poll no longer offers the requested slot. */
export const POLL_CHANGED_MESSAGE =
  'This poll changed — refresh to see the latest';

/** Options for {@link SchedulingLock.requestLock}. */
export interface RequestLockOptions {
  /** Open the confirm even when the threshold is met (DM deep link). */
  forceConfirm?: boolean;
}

interface FreshSlot {
  slot: ScheduleSlotWithVotesDto;
  memberCount: number;
}

/**
 * Fetch the poll bypassing the cache (same key as `useSchedulePoll`) and
 * re-find the slot. Null when the fetch fails, the poll is no longer open,
 * or the slot is gone.
 */
async function loadFreshSlot(
  qc: QueryClient,
  ids: { lineupId: number; matchId: number; slotId: number },
): Promise<FreshSlot | null> {
  const { lineupId, matchId, slotId } = ids;
  let poll: SchedulePollPageResponseDto;
  try {
    poll = await qc.fetchQuery({
      queryKey: ['scheduling', 'poll', lineupId, matchId],
      queryFn: () => getSchedulePoll(lineupId, matchId),
      staleTime: 0,
    });
  } catch {
    return null;
  }
  if (resolvePollStatus(poll) !== 'open') return null;
  const slot = poll.slots.find((s) => s.id === slotId);
  return slot ? { slot, memberCount: poll.match.members.length } : null;
}

export interface SchedulingLock {
  /** Slot awaiting early-lock confirmation; null when no modal is open. */
  pendingSlot: ScheduleSlotWithVotesDto | null;
  /** Distinct voters on the pending slot, from the FRESH poll. */
  pendingDistinctVoters: number;
  /** Member count from the same fresh poll (confirm modal copy). */
  pendingMemberCount: number;
  /** True while the fresh poll is being fetched. */
  refreshing: boolean;
  /** Begin a lock — refetches, runs guards, then confirm-or-commit. */
  requestLock: (
    slot: ScheduleSlotWithVotesDto,
    opts?: RequestLockOptions,
  ) => Promise<void>;
  /** Confirm an early lock from the modal. */
  confirmLock: () => void;
  /** Dismiss the confirm modal without locking. */
  cancelLock: () => void;
}

/** `/events/new` target for locking an unlinked poll's slot. */
function createEventUrl(
  match: MatchDetailResponseDto,
  matchId: number,
  slot: ScheduleSlotWithVotesDto,
): string {
  const params = new URLSearchParams();
  if (match.gameId) params.set('gameId', String(match.gameId));
  params.set('startTime', slot.proposedTime);
  params.set('matchId', String(matchId));
  // Follow-up polls carry the ended event so the create form prefills from
  // it. Ordinary polls have no source event and open with defaults.
  if (match.followupForEventId != null) {
    params.set('copyFromEventId', String(match.followupForEventId));
  }
  return `/events/new?${params.toString()}`;
}

/** The commit step: reschedule the linked event, or open the create form. */
function useLockCommit(
  match: MatchDetailResponseDto,
  matchId: number,
): (slot: ScheduleSlotWithVotesDto) => void {
  const navigate = useNavigate();
  const reschedule = useRescheduleEvent(match.linkedEventId ?? 0);
  return (slot: ScheduleSlotWithVotesDto): void => {
    const start = new Date(slot.proposedTime);
    if (start <= new Date()) {
      toast.error('Cannot lock a time in the past');
      return;
    }
    if (match.linkedEventId != null) {
      // Capture now: property narrowing doesn't survive into the callback.
      const eventId = match.linkedEventId;
      const end = new Date(start.getTime() + TWO_HOURS_MS);
      reschedule.mutate(
        { startTime: start.toISOString(), endTime: end.toISOString() },
        {
          onSuccess: () => {
            // startTime must be the same instant as slot.proposedTime — the
            // backend matches it to a slot by Date-getTime equality (ROK-1031).
            void completeStandalonePoll(matchId, eventId, start.toISOString());
            toast.success('Event rescheduled');
          },
          onError: (err) =>
            toast.error(
              err instanceof Error ? err.message : 'Failed to reschedule',
            ),
        },
      );
      return;
    }
    navigate(createEventUrl(match, matchId, slot));
  };
}

/** Owns the lock flow for a match. */
export function useSchedulingLock(
  match: MatchDetailResponseDto,
  matchId: number,
  lineupId: number,
): SchedulingLock {
  const commit = useLockCommit(match, matchId);
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingMemberCount, setPendingMemberCount] = useState(0);
  const [pendingSlot, setPendingSlot] =
    useState<ScheduleSlotWithVotesDto | null>(null);

  const requestLock = async (
    requested: ScheduleSlotWithVotesDto,
    opts: RequestLockOptions = {},
  ): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    const ids = { lineupId, matchId, slotId: requested.id };
    const fresh = await loadFreshSlot(qc, ids);
    inFlight.current = false;
    setRefreshing(false);
    if (!fresh) {
      toast.error(POLL_CHANGED_MESSAGE);
      return;
    }
    const required = computeRequiredVoters(fresh.memberCount);
    if (opts.forceConfirm || countDistinctVoters(fresh.slot) < required) {
      setPendingMemberCount(fresh.memberCount);
      setPendingSlot(fresh.slot);
      return;
    }
    commit(fresh.slot);
  };

  const confirmLock = (): void => {
    const slot = pendingSlot;
    setPendingSlot(null);
    if (slot) commit(slot);
  };

  return {
    pendingSlot,
    pendingDistinctVoters: pendingSlot
      ? countDistinctVoters(pendingSlot)
      : 0,
    pendingMemberCount,
    refreshing,
    requestLock,
    confirmLock,
    cancelLock: () => setPendingSlot(null),
  };
}
