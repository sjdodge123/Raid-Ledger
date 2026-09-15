/**
 * TanStack Query hooks for Scheduling Poll features (ROK-965).
 * Wraps scheduling-api.ts functions with query caching and mutation invalidation.
 */
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  SchedulePollPageResponseDto,
  ScheduleSlotWithVotesDto,
  SchedulingBannerDto,
  OtherPollsResponseDto,
  AggregateGameTimeResponse,
  RemindVotersResponseDto,
} from '@raid-ledger/contract';
import { toast } from '../lib/toast';
import {
  getSchedulePoll,
  suggestSlot,
  toggleScheduleVote,
  createEventFromSlot,
  retractAllVotes,
  getMatchAvailability,
  getSchedulingBanner,
  getOtherPolls,
  cancelSchedulePoll,
  remindVoters,
  addPollMembers,
} from '../lib/api-client';
import { PARTICIPANTS_KEY } from './use-lineups';

/** Query key prefix for scheduling poll queries. */
const SCHEDULE_KEY = ['scheduling'] as const;
/** Query key for the scheduling banner on the events page. */
const BANNER_KEY = ['scheduling', 'banner'] as const;

/** One entry of a slot's voter list — the viewer's own, when we patch it in. */
export type SchedulingVoter = ScheduleSlotWithVotesDto['votes'][number];

/** Variables for the one-tap vote toggle (ROK-1544). */
export interface ToggleScheduleVoteVars {
  lineupId: number;
  matchId: number;
  slotId: number;
  /**
   * The viewer's voter identity. Supplied by the poll surface so the
   * optimistic patch can move the numbers the tap is about; omitted (e.g. an
   * anonymous caller) the vote list is left to the refetch.
   */
  viewer?: SchedulingVoter;
}

/** Toggle a slotId within the myVotedSlotIds array. */
function toggleSlotId(ids: number[], slotId: number): number[] {
  return ids.includes(slotId) ? ids.filter((id) => id !== slotId) : [...ids, slotId];
}

/**
 * Add or drop the viewer in the toggled slot's voter list.
 *
 * ROK-1543 promoted the vote counts above the fold (leader card, "N of M
 * members picked this time", the row's count + avatars) — all of which read
 * `slots[].votes`. Patching only `myVotedSlotIds` left those frozen until the
 * `onSettled` refetch, so the card did not move on the tap.
 */
function patchSlotVotes(
  slots: ScheduleSlotWithVotesDto[],
  slotId: number,
  viewer: SchedulingVoter | undefined,
  nowVoted: boolean,
): ScheduleSlotWithVotesDto[] {
  if (!viewer) return slots;
  return slots.map((slot) => {
    if (slot.id !== slotId) return slot;
    const others = slot.votes.filter((v) => v.userId !== viewer.userId);
    return { ...slot, votes: nowVoted ? [...others, viewer] : others };
  });
}

/** Optimistically toggle the vote (and its slot's voter list) in the cache. */
async function optimisticToggle(
  qc: QueryClient, vars: ToggleScheduleVoteVars,
): Promise<{ prev: SchedulePollPageResponseDto | undefined }> {
  const { lineupId, matchId, slotId, viewer } = vars;
  const key = [...SCHEDULE_KEY, 'poll', lineupId, matchId];
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<SchedulePollPageResponseDto>(key);
  if (prev) {
    const nowVoted = !prev.myVotedSlotIds.includes(slotId);
    qc.setQueryData(key, {
      ...prev,
      myVotedSlotIds: toggleSlotId(prev.myVotedSlotIds, slotId),
      slots: patchSlotVotes(prev.slots, slotId, viewer, nowVoted),
    });
  }
  return { prev };
}

/**
 * Invalidate every view of a poll's vote state.
 *
 * ROK-1557: the participants roster renders "Voted / Waiting" chips off the
 * same votes the slot ladder does, so a mutation that leaves it alone strands
 * the modal on the page-load snapshot.
 */
function invalidatePollViews(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] });
  void qc.invalidateQueries({ queryKey: [...PARTICIPANTS_KEY] });
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
    onSuccess: () => { invalidatePollViews(qc); },
    onError: (err) => { toast.error(err.message || 'Failed to suggest time'); },
  });
}

/** Hook for toggling a vote on a schedule slot with optimistic update. */
export function useToggleScheduleVote() {
  const qc = useQueryClient();
  type Ctx = { prev: SchedulePollPageResponseDto | undefined };
  return useMutation<{ voted: boolean }, Error, ToggleScheduleVoteVars, Ctx>({
    mutationFn: ({ lineupId, matchId, slotId }) => toggleScheduleVote(lineupId, matchId, slotId),
    onMutate: (vars) => optimisticToggle(qc, vars),
    onError: (err, { lineupId, matchId }, ctx) => {
      // ROK-1544: the tap is the whole action, so a failed write has to be
      // visible — roll the optimistic vote back AND say why.
      if (ctx?.prev) qc.setQueryData([...SCHEDULE_KEY, 'poll', lineupId, matchId], ctx.prev);
      toast.error(err.message || 'Failed to save your vote');
    },
    onSettled: () => { invalidatePollViews(qc); },
  });
}

/** Hook for retracting all votes on a poll. */
export function useRetractAllVotes() {
  const qc = useQueryClient();
  return useMutation<void, Error, { lineupId: number; matchId: number }>({
    mutationFn: ({ lineupId, matchId }) => retractAllVotes(lineupId, matchId),
    onSuccess: () => { invalidatePollViews(qc); },
  });
}

/**
 * Hook for creating an event from a selected slot.
 *
 * @deprecated Use POST /events with matchId param instead (ROK-1121).
 * Endpoint retained for smoke-test compatibility — full removal tracked
 * separately.
 */
export function useCreateEventFromSlot() {
  const qc = useQueryClient();
  return useMutation<{ eventId: number }, Error, { lineupId: number; matchId: number; slotId: number; recurring?: boolean }>({
    mutationFn: ({ lineupId, matchId, slotId, recurring }) => createEventFromSlot(lineupId, matchId, slotId, recurring),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] });
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

/** Hook for fetching match members' availability heatmap data. */
export function useMatchAvailability(lineupId: number, matchId: number) {
  return useQuery<AggregateGameTimeResponse>({
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

/**
 * Hook for the manual "Remind voters" nudge (ROK-1395, creator/operator).
 * Success toasts the reminded/skipped counts; a cooldown 429 (or any other
 * failure) surfaces the server's message via the error toast.
 */
export function useRemindVoters() {
  return useMutation<RemindVotersResponseDto, Error, { lineupId: number; matchId: number }>({
    mutationFn: ({ lineupId, matchId }) => remindVoters(lineupId, matchId),
    onSuccess: ({ reminded, skipped }) => {
      toast.success(`Reminded ${reminded} voter${reminded === 1 ? '' : 's'} (${skipped} skipped)`);
    },
    onError: (err) => { toast.error(err.message || 'Failed to send reminders'); },
  });
}

/**
 * Hook for explicitly enrolling members in a scheduling poll (ROK-1440).
 * Invalidates the schedule query so the poll's member denominator ("N people
 * in this poll") and the availability heatmap both refresh.
 */
export function useAddPollMembers() {
  const qc = useQueryClient();
  return useMutation<
    { added: number; memberCount: number },
    Error,
    { lineupId: number; matchId: number; userIds: number[] }
  >({
    mutationFn: ({ lineupId, matchId, userIds }) =>
      addPollMembers(lineupId, matchId, userIds),
    onSuccess: ({ added }) => {
      void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] });
      toast.success(
        added === 0
          ? 'Already in this poll'
          : `Added ${added} participant${added === 1 ? '' : 's'}`,
      );
    },
    onError: (err) => {
      toast.error(err.message || 'Failed to add participants');
    },
  });
}

/** Hook for cancelling a scheduling poll (operator). Optional reason notifies voters. */
export function useCancelSchedulePoll() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { lineupId: number; matchId: number; reason?: string | null }>({
    mutationFn: ({ lineupId, matchId, reason }) => cancelSchedulePoll(lineupId, matchId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] });
      toast.success('Scheduling poll cancelled');
    },
    onError: (err) => { toast.error(err.message || 'Failed to cancel poll'); },
  });
}
