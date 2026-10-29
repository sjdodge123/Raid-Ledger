/**
 * Lock state machine for the ROK-1300 Scheduling composite.
 *
 * Lifts the per-slot "Lock this time →" logic out of the retired
 * `CreateEventSection` dropdown so it lives once, at composite level:
 *   - past-time guard (toast + abort),
 *   - majority-voter threshold → confirm modal for an early lock,
 *   - reschedule-vs-create branch: `linkedEventId != null` calls the
 *     claim-first `rescheduleLockInSchedulingPoll` (ROK-2040), which moves the
 *     linked event and re-rosters the slot's voters (ROK-1031) in one request —
 *     a losing racer gets a 409 and moves nothing (the winner already did);
 *     otherwise navigate to `/events/new?gameId&startTime&matchId&lineupId` (verbatim
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
import {
  getSchedulePoll,
  rescheduleLockInSchedulingPoll,
} from '../../../lib/api-client';
import { isConflictError } from '../../../lib/api/api-error';
import { toast } from '../../../lib/toast';
import {
  computeRequiredVoters,
  countDistinctVoters,
} from '../../../pages/scheduling/threshold';
import { resolvePollStatus } from './scheduling-poll-status';
import { invalidateHubPolls } from '../../hub/events/hub-polls-api';
import { refreshLockedInEvent } from '../../events/use-bench-pick';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Toast when the fresh poll no longer offers the requested slot. */
export const POLL_CHANGED_MESSAGE =
  'This poll changed — refresh to see the latest';

/** Toast for the reschedule lock-in that lost the race (ROK-2040). */
export const RESCHEDULE_LOCK_IN_LOST_TOAST =
  'Someone else locked in this poll first. The event now starts at the time they picked.';

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
  /** True while the fresh poll is fetched or the lock-in request runs. */
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

/** `/events/new` target for locking an unlinked poll's slot. Exported for its spec. */
export function createEventUrl(
  match: MatchDetailResponseDto,
  ids: { matchId: number; lineupId: number; hubId?: number | null },
  slot: ScheduleSlotWithVotesDto,
): string {
  const params = new URLSearchParams();
  if (match.gameId) params.set('gameId', String(match.gameId));
  params.set('startTime', slot.proposedTime);
  params.set('matchId', String(ids.matchId));
  // ROK-1874: the create form re-reads this poll to warn when the slot's
  // yes-voters overflow the roster.
  params.set('lineupId', String(ids.lineupId));
  // ROK-1893 P3: a hub poll's event inherits the hub — the form preselects it.
  if (ids.hubId != null) params.set('guildId', String(ids.hubId));
  // Follow-up polls carry the ended event so the create form prefills from
  // it. Ordinary polls have no source event and open with defaults.
  if (match.followupForEventId != null) {
    params.set('copyFromEventId', String(match.followupForEventId));
  }
  return `/events/new?${params.toString()}`;
}

/** Refetch everything a reschedule lock-in (won or lost) may have changed. */
function refreshAfterReschedule(qc: QueryClient, eventId: number): void {
  void qc.invalidateQueries({ queryKey: ['events'] });
  void qc.invalidateQueries({ queryKey: ['event', eventId] });
  invalidateHubPolls(qc);
  refreshLockedInEvent(qc, eventId);
}

/** ROK-2040: one claim-first request moves the event and closes the poll. */
async function lockInReschedule(
  qc: QueryClient,
  ids: { matchId: number; eventId: number },
  start: Date,
): Promise<void> {
  const end = new Date(start.getTime() + TWO_HOURS_MS);
  try {
    // startTime must be the same instant as slot.proposedTime — the backend
    // matches it to a slot by Date-getTime equality (ROK-1031).
    await rescheduleLockInSchedulingPoll(ids.matchId, {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
    toast.success('Event rescheduled');
  } catch (err) {
    if (isConflictError(err)) toast.error(RESCHEDULE_LOCK_IN_LOST_TOAST);
    else toast.error(err instanceof Error ? err.message : 'Failed to reschedule');
  }
  refreshAfterReschedule(qc, ids.eventId);
}

/** The commit step: reschedule the linked event, or open the create form. */
function useLockCommit(
  match: MatchDetailResponseDto,
  matchId: number,
  lineupId: number,
  hubId: number | null,
): (slot: ScheduleSlotWithVotesDto) => Promise<void> {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return async (slot: ScheduleSlotWithVotesDto): Promise<void> => {
    const start = new Date(slot.proposedTime);
    if (start <= new Date()) {
      toast.error('Cannot lock a time in the past');
      return;
    }
    if (match.linkedEventId != null) {
      const ids = { matchId, eventId: match.linkedEventId };
      await lockInReschedule(qc, ids, start);
      return;
    }
    navigate(createEventUrl(match, { matchId, lineupId, hubId }, slot));
  };
}

/** Owns the lock flow for a match. */
export function useSchedulingLock(
  match: MatchDetailResponseDto,
  matchId: number,
  lineupId: number,
  /** ROK-1893 P3: the poll's hub, carried into the create-event deep link. */
  hubId: number | null = null,
): SchedulingLock {
  const commit = useLockCommit(match, matchId, lineupId, hubId);
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingMemberCount, setPendingMemberCount] = useState(0);
  const [pendingSlot, setPendingSlot] =
    useState<ScheduleSlotWithVotesDto | null>(null);

  /** Run `step` once at a time; a second click while one runs is dropped. */
  const exclusive = async (step: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      await step();
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  };

  const requestLock = (
    requested: ScheduleSlotWithVotesDto,
    opts: RequestLockOptions = {},
  ): Promise<void> =>
    exclusive(async () => {
      const ids = { lineupId, matchId, slotId: requested.id };
      const fresh = await loadFreshSlot(qc, ids);
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
      // Held until the lock-in settles, so a double click cannot send two.
      await commit(fresh.slot);
    });

  const confirmLock = (): void => {
    const slot = pendingSlot;
    setPendingSlot(null);
    if (slot) void exclusive(() => commit(slot));
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
