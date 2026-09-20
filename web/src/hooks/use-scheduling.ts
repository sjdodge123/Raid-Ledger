/**
 * TanStack Query hooks for Scheduling Poll features (ROK-965).
 * Wraps scheduling-api.ts functions with query caching and mutation invalidation.
 */
import { useQuery, useMutation, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query';
import type {
  SchedulePollPageResponseDto,
  ScheduleSlotWithVotesDto,
  SchedulingBannerDto,
  OtherPollsResponseDto,
  AggregateGameTimeResponse,
  RallyNonVotersResponseDto,
  RemindVotersResponseDto,
  ScheduleVoteStance,
  ScheduleVoteSource,
} from '@raid-ledger/contract';
import { summariseRally } from '@raid-ledger/contract';
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
  rallyNonVoters,
  addPollMembers,
} from '../lib/api-client';
import { PARTICIPANTS_KEY } from './use-lineups';
import { weekStartQueryValue, weekTzOffsetMinutes } from '../lib/week-start-query';

/** Query key prefix for scheduling poll queries. */
const SCHEDULE_KEY = ['scheduling'] as const;
/** Query key for the scheduling banner on the events page. */
const BANNER_KEY = ['scheduling', 'banner'] as const;

/**
 * Mutation key prefix shared by every vote toggle (ROK-1551, S2-AC3). The live
 * handler checks `isMutating` on it so a socket refetch never lands on top of
 * an optimistic tick. A prefix (not per-poll) because the ids arrive as
 * mutation variables; two polls voting in one tab is not a real case.
 */
export const SCHEDULE_VOTE_MUTATION_KEY = ['scheduling', 'vote'] as const;

/** Cache key of one poll's page response. */
export function schedulePollKey(lineupId: number, matchId: number): readonly unknown[] {
  return [...SCHEDULE_KEY, 'poll', lineupId, matchId];
}

/** Options for {@link useSchedulePoll}. */
export interface SchedulePollQueryOptions {
  /** ROK-1551: the disconnected-socket fallback poll (see `liveRefetchInterval`). */
  refetchInterval?: (query: Query<SchedulePollPageResponseDto>) => number | false;
}

/** One entry of a slot's voter list — the viewer's own, when we patch it in. */
export type SchedulingVoter = ScheduleSlotWithVotesDto['votes'][number];

/** Variables for suggesting a slot (ROK-965; `source` ROK-1550). */
export interface SuggestSlotVars {
  lineupId: number;
  matchId: number;
  proposedTime: string;
  /**
   * ROK-1550: where the visit that produced the suggestion came from. The
   * server auto-votes for the new slot, so this is that vote's provenance.
   * Omitted — every non-poll-page caller — it is an ordinary web suggestion.
   */
  source?: ScheduleVoteSource;
}

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
  /** ROK-1617: which answer was pressed. Defaults to `'yes'`. */
  stance?: ScheduleVoteStance;
  /**
   * ROK-1550: where the visit the vote was cast in came from. Supplied by the
   * poll surface (`useVoteSource`); omitted it is an ordinary web vote. The
   * optimistic patch ignores it — it changes nothing the viewer can see.
   */
  source?: ScheduleVoteSource;
}

/** Add or drop a slotId in one of the viewer's stance lists. */
function setSlotId(ids: number[], slotId: number, present: boolean): number[] {
  const without = ids.filter((id) => id !== slotId);
  return present ? [...without, slotId] : without;
}

/**
 * The stance the tap lands on (ROK-1617), mirroring the server's
 * `resolveStanceAction`: pressing the answer already on record clears it,
 * pressing the other one replaces it.
 */
function nextStance(
  current: ScheduleVoteStance | null,
  pressed: ScheduleVoteStance,
): ScheduleVoteStance | null {
  return current === pressed ? null : pressed;
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
  landed: ScheduleVoteStance | null,
): ScheduleSlotWithVotesDto[] {
  if (!viewer) return slots;
  return slots.map((slot) => {
    if (slot.id !== slotId) return slot;
    // The viewer holds at most ONE row per slot, so they are removed from both
    // lists before being put back on the side they landed on.
    const yes = slot.votes.filter((v) => v.userId !== viewer.userId);
    const no = (slot.noVotes ?? []).filter((v) => v.userId !== viewer.userId);
    return {
      ...slot,
      votes: landed === 'yes' ? [...yes, viewer] : yes,
      noVotes: landed === 'no' ? [...no, viewer] : no,
    };
  });
}

/** Optimistically toggle the vote (and its slot's voter list) in the cache. */
async function optimisticToggle(
  qc: QueryClient, vars: ToggleScheduleVoteVars,
): Promise<{ prev: SchedulePollPageResponseDto | undefined }> {
  const { lineupId, matchId, slotId, viewer, stance = 'yes' } = vars;
  const key = [...SCHEDULE_KEY, 'poll', lineupId, matchId];
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<SchedulePollPageResponseDto>(key);
  if (prev) {
    const current: ScheduleVoteStance | null = prev.myVotedSlotIds.includes(slotId)
      ? 'yes'
      : (prev.myNoSlotIds ?? []).includes(slotId)
        ? 'no'
        : null;
    const landed = nextStance(current, stance);
    qc.setQueryData(key, {
      ...prev,
      myVotedSlotIds: setSlotId(prev.myVotedSlotIds, slotId, landed === 'yes'),
      myNoSlotIds: setSlotId(prev.myNoSlotIds ?? [], slotId, landed === 'no'),
      slots: patchSlotVotes(prev.slots, slotId, viewer, landed),
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
function invalidatePollViews(
  qc: QueryClient,
  lineupId: number,
  matchId: number,
): void {
  void qc.invalidateQueries({ queryKey: [...SCHEDULE_KEY] });
  // Scoped to THIS poll's roster — other lineups' cached rosters stay put.
  void qc.invalidateQueries({
    queryKey: [...PARTICIPANTS_KEY, lineupId, matchId],
  });
}

/** Hook for fetching full scheduling poll page data. */
export function useSchedulePoll(lineupId: number, matchId: number, opts?: SchedulePollQueryOptions) {
  return useQuery<SchedulePollPageResponseDto>({
    queryKey: schedulePollKey(lineupId, matchId),
    queryFn: () => getSchedulePoll(lineupId, matchId),
    enabled: !!lineupId && !!matchId,
    staleTime: 15_000,
    refetchInterval: opts?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Hook for suggesting a new time slot.
 *
 * ROK-1550: `source` is optional and defaults to a web suggestion, so the LFG
 * "find a time" caller — which is never a poll-card arrival — stays unchanged.
 * The poll page supplies its captured visit source, because the server
 * auto-votes for the suggested slot.
 */
export function useSuggestSlot() {
  const qc = useQueryClient();
  return useMutation<{ id: number }, Error, SuggestSlotVars>({
    mutationFn: ({ lineupId, matchId, proposedTime, source }) => suggestSlot(lineupId, matchId, proposedTime, source),
    onSuccess: (_res, { lineupId, matchId }) => { invalidatePollViews(qc, lineupId, matchId); },
    onError: (err) => { toast.error(err.message || 'Failed to suggest time'); },
  });
}

/** Hook for toggling a vote on a schedule slot with optimistic update. */
export function useToggleScheduleVote() {
  const qc = useQueryClient();
  type Ctx = { prev: SchedulePollPageResponseDto | undefined };
  return useMutation<
    { voted: boolean; stance: ScheduleVoteStance | null },
    Error,
    ToggleScheduleVoteVars,
    Ctx
  >({
    mutationKey: [...SCHEDULE_VOTE_MUTATION_KEY],
    mutationFn: ({ lineupId, matchId, slotId, stance, source }) =>
      toggleScheduleVote(lineupId, matchId, slotId, stance, source),
    onMutate: (vars) => optimisticToggle(qc, vars),
    onError: (err, { lineupId, matchId }, ctx) => {
      // ROK-1544: the tap is the whole action, so a failed write has to be
      // visible — roll the optimistic vote back AND say why.
      if (ctx?.prev) qc.setQueryData([...SCHEDULE_KEY, 'poll', lineupId, matchId], ctx.prev);
      toast.error(err.message || 'Failed to save your vote');
    },
    onSettled: (_res, _err, { lineupId, matchId }) => { invalidatePollViews(qc, lineupId, matchId); },
  });
}

/** Hook for retracting all votes on a poll. */
export function useRetractAllVotes() {
  const qc = useQueryClient();
  return useMutation<void, Error, { lineupId: number; matchId: number }>({
    mutationFn: ({ lineupId, matchId }) => retractAllVotes(lineupId, matchId),
    onSuccess: (_res, { lineupId, matchId }) => { invalidatePollViews(qc, lineupId, matchId); },
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

/**
 * Hook for fetching match members' availability heatmap data.
 *
 * ROK-1570: the aggregate is DATED — the server subtracts each member's
 * signups and absences for `weekStart`'s week, keyed in the viewer's zone — so
 * the displayed week AND its UTC offset are part of the cache key, and paging
 * the grid (including across a DST boundary, which moves the offset) re-fetches
 * rather than re-painting last week's numbers on next week's cells.
 */
export function useMatchAvailability(
  lineupId: number,
  matchId: number,
  weekStart: Date,
) {
  return useQuery<AggregateGameTimeResponse>({
    queryKey: [
      ...SCHEDULE_KEY, 'availability', lineupId, matchId,
      weekStartQueryValue(weekStart), weekTzOffsetMinutes(weekStart),
    ],
    queryFn: () => getMatchAvailability(lineupId, matchId, weekStart),
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

/** Variables for {@link useRallyNonVoters}. */
export interface RallyNonVotersVars {
  lineupId: number;
  matchId: number;
}

/**
 * Hook for the leader card's "Rally" nudge (ROK-1618, creator/operator).
 *
 * The success copy is `summariseRally` from `@raid-ledger/contract` — the SAME
 * string table the API's unit spec pins, so the web never re-words it. Any
 * failure (the 6h cooldown's 429, a plain member's 403, a closed poll's 400)
 * surfaces the server's own `message` verbatim.
 */
export function useRallyNonVoters() {
  const qc = useQueryClient();
  return useMutation<RallyNonVotersResponseDto, Error, RallyNonVotersVars>({
    mutationFn: ({ lineupId, matchId }) => rallyNonVoters(lineupId, matchId),
    onSuccess: ({ pending, nudged, skipped }, { lineupId, matchId }) => {
      // The nudge does not change the poll, but the pending count the row's
      // subline reads does drift while the sheet is open — refresh it.
      invalidatePollViews(qc, lineupId, matchId);
      toast.success(summariseRally(pending, nudged, skipped));
    },
    onError: (err) => {
      toast.error(err.message || 'Failed to rally voters');
    },
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
    onSuccess: ({ added }, { lineupId, matchId }) => {
      // ROK-1557 (Codex P2): the roster is cached under PARTICIPANTS_KEY now,
      // so adding members must refresh it too, not just the poll.
      invalidatePollViews(qc, lineupId, matchId);
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
