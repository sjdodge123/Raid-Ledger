/**
 * TanStack Query hooks for Scheduling Poll features (ROK-965).
 * Wraps scheduling-api.ts functions with query caching and mutation invalidation.
 */
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  SchedulePollPageResponseDto,
  SchedulingBannerDto,
  OtherPollsResponseDto,
  RosterAvailabilityResponse,
} from '@raid-ledger/contract';
import {
  getSchedulePoll,
  suggestSlot,
  toggleScheduleVote,
  createEventFromSlot,
  retractAllVotes,
  getMatchAvailability,
  getSchedulingBanner,
  getOtherPolls,
} from '../lib/api-client';

/** Query key prefix for scheduling poll queries. */
const SCHEDULE_KEY = ['scheduling'] as const;
/** Query key for the scheduling banner on the events page. */
const BANNER_KEY = ['scheduling', 'banner'] as const;

/** Toggle a slotId within the myVotedSlotIds array. */
function toggleSlotId(ids: number[], slotId: number): number[] {
  return ids.includes(slotId) ? ids.filter((id) => id !== slotId) : [...ids, slotId];
}

/** Optimistically toggle the vote in the cache. */
async function optimisticToggle(
  qc: QueryClient, lineupId: number, matchId: number, slotId: number,
): Promise<{ prev: SchedulePollPageResponseDto | undefined }> {
  const key = [...SCHEDULE_KEY, 'poll', lineupId, matchId];
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<SchedulePollPageResponseDto>(key);
  if (prev) {
    qc.setQueryData(key, { ...prev, myVotedSlotIds: toggleSlotId(prev.myVotedSlotIds, slotId) });
  }
  return { prev };
}

/** Hook for fetching full scheduling poll page data. */
export function useSchedulePoll(lineupId: number, matchId: number) {
  return useQuery<SchedulePollPageResponseDto>({
    queryKey: [...SCHEDULE_KEY, 'poll', lineupId, matchId],
    queryFn: () => getSchedulePoll(lineupId, matchId),
    enabled: !!lineupId && !!matchId,
    staleTime: 15_000,
  });
}

/** Hook for suggesting a new time slot. */
export function useSuggestSlot() {
  const qc = useQueryClient();
  return useMutation<{ id: number }, Error, { lineupId: number; matchId: number; proposedTime: string }>({
    mutationFn: ({ lineupId, matchId, proposedTime }) => suggestSlot(lineupId, matchId, proposedTime),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] }); },
  });
}

/** Hook for toggling a vote on a schedule slot with optimistic update. */
export function useToggleScheduleVote() {
  const qc = useQueryClient();
  return useMutation<{ voted: boolean }, Error, { lineupId: number; matchId: number; slotId: number }>({
    mutationFn: ({ lineupId, matchId, slotId }) => toggleScheduleVote(lineupId, matchId, slotId),
    onMutate: ({ lineupId, matchId, slotId }) => optimisticToggle(qc, lineupId, matchId, slotId),
    onError: (_err, { lineupId, matchId }, ctx) => {
      if (ctx?.prev) qc.setQueryData([...SCHEDULE_KEY, 'poll', lineupId, matchId], ctx.prev);
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] }); },
  });
}

/** Hook for retracting all votes on a poll. */
export function useRetractAllVotes() {
  const qc = useQueryClient();
  return useMutation<void, Error, { lineupId: number; matchId: number }>({
    mutationFn: ({ lineupId, matchId }) => retractAllVotes(lineupId, matchId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] }); },
  });
}

/** Hook for creating an event from a selected slot. */
export function useCreateEventFromSlot() {
  const qc = useQueryClient();
  return useMutation<{ eventId: number }, Error, { lineupId: number; matchId: number; slotId: number }>({
    mutationFn: ({ lineupId, matchId, slotId }) => createEventFromSlot(lineupId, matchId, slotId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] });
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

/** Hook for fetching match members' availability heatmap data. */
export function useMatchAvailability(lineupId: number, matchId: number) {
  return useQuery<RosterAvailabilityResponse>({
    queryKey: [...SCHEDULE_KEY, 'availability', lineupId, matchId],
    queryFn: () => getMatchAvailability(lineupId, matchId),
    enabled: !!lineupId && !!matchId,
    staleTime: 60_000,
  });
}

/** Hook for fetching the scheduling banner on the events page. */
export function useSchedulingBanner() {
  return useQuery<SchedulingBannerDto | null>({
    queryKey: [...BANNER_KEY],
    queryFn: getSchedulingBanner,
    staleTime: 120_000,
    retry: false,
  });
}

/** Hook for fetching other scheduling polls for the current user. */
export function useOtherPolls(lineupId: number, matchId: number) {
  return useQuery<OtherPollsResponseDto>({
    queryKey: [...SCHEDULE_KEY, 'other-polls', lineupId, matchId],
    queryFn: () => getOtherPolls(lineupId, matchId),
    enabled: !!lineupId && !!matchId,
    staleTime: 60_000,
  });
}
