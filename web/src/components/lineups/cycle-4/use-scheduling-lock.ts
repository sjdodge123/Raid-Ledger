/**
 * Lock state machine for the ROK-1300 Scheduling composite.
 *
 * Lifts the per-slot "Lock this time →" logic out of the retired
 * `CreateEventSection` dropdown so it lives once, at composite level:
 *   - past-time guard (toast + abort),
 *   - majority-voter threshold → confirm modal for an early lock,
 *   - reschedule-vs-create branch: `linkedEventId != null` reschedules the
 *     linked event then `completeStandalonePoll(matchId)`; otherwise navigate
 *     to `/events/new?gameId&startTime&matchId` (verbatim target from
 *     `CreateFromSlot::performNavigate`).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  MatchDetailResponseDto,
  ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import { useRescheduleEvent } from '../../../hooks/use-reschedule';
import { completeStandalonePoll } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import {
  computeRequiredVoters,
  countDistinctVoters,
} from '../../../pages/scheduling/threshold';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export interface SchedulingLock {
  /** Slot awaiting early-lock confirmation; null when no modal is open. */
  pendingSlot: ScheduleSlotWithVotesDto | null;
  /** Distinct voters on the pending slot (for the confirm modal copy). */
  pendingDistinctVoters: number;
  /** Begin a lock for a slot — runs guards, then confirm-or-commit. */
  requestLock: (slot: ScheduleSlotWithVotesDto) => void;
  /** Confirm an early lock from the modal. */
  confirmLock: () => void;
  /** Dismiss the confirm modal without locking. */
  cancelLock: () => void;
}

/** Owns the lock flow for a match. */
export function useSchedulingLock(
  match: MatchDetailResponseDto,
  matchId: number,
): SchedulingLock {
  const navigate = useNavigate();
  const reschedule = useRescheduleEvent(match.linkedEventId ?? 0);
  const [pendingSlot, setPendingSlot] =
    useState<ScheduleSlotWithVotesDto | null>(null);

  const commit = (slot: ScheduleSlotWithVotesDto): void => {
    const start = new Date(slot.proposedTime);
    if (start <= new Date()) {
      toast.error('Cannot lock a time in the past');
      return;
    }
    if (match.linkedEventId != null) {
      const end = new Date(start.getTime() + TWO_HOURS_MS);
      reschedule.mutate(
        { startTime: start.toISOString(), endTime: end.toISOString() },
        {
          onSuccess: () => {
            void completeStandalonePoll(matchId);
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
    const params = new URLSearchParams();
    if (match.gameId) params.set('gameId', String(match.gameId));
    params.set('startTime', slot.proposedTime);
    params.set('matchId', String(matchId));
    navigate(`/events/new?${params.toString()}`);
  };

  const requestLock = (slot: ScheduleSlotWithVotesDto): void => {
    const required = computeRequiredVoters(match.members.length);
    const distinct = countDistinctVoters(slot);
    if (distinct < required) {
      setPendingSlot(slot);
      return;
    }
    commit(slot);
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
    requestLock,
    confirmLock,
    cancelLock: () => setPendingSlot(null),
  };
}
