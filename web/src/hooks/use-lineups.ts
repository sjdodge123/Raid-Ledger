/**
 * React Query hooks for Community Lineup features (ROK-934).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  LineupDetailResponseDto,
  LineupBannerResponseDto,
  LineupSummaryResponseDto,
  CommonGroundResponseDto,
  NominateGameDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../lib/api-client';
import {
  getActiveLineups,
  getCommonGround,
  nominateGame,
  getLineupBanner,
  getLineupById,
  removeNomination,
  createLineup,
  transitionLineupStatus,
  toggleVote,
  updateLineupMetadata,
  addLineupInvitees,
  removeLineupInvitee,
} from '../lib/api-client';
import type {
  CreateLineupParams,
  UpdateLineupMetadataParams,
} from '../lib/api/lineups-api';

/** Query key for the active lineup. */
const ACTIVE_LINEUP_KEY = ['lineups', 'active'] as const;
/** Query key for the banner. */
const BANNER_KEY = ['lineups', 'banner'] as const;
/** Query key prefix for lineup detail queries. */
export const DETAIL_KEY = ['lineups', 'detail'] as const;
/** Query key prefix for common ground queries. */
const COMMON_GROUND_KEY = ['common-ground'] as const;
/** Shared prefix for all lineup query invalidation. */
export const LINEUPS_PREFIX = ['lineups'] as const;

/**
 * Hook for fetching every currently active lineup (ROK-1065).
 * Returns an array ordered newest-first. Was singular pre-ROK-1065.
 */
export function useActiveLineups() {
  return useQuery<LineupSummaryResponseDto[]>({
    queryKey: [...ACTIVE_LINEUP_KEY],
    queryFn: getActiveLineups,
    staleTime: 30_000,
    retry: false,
  });
}

/** Hook for fetching Common Ground games with filters. */
export function useCommonGround(
  params: CommonGroundParams,
  enabled = true,
) {
  return useQuery<CommonGroundResponseDto>({
    queryKey: [...COMMON_GROUND_KEY, params],
    queryFn: () => getCommonGround(params),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** Hook for nominating a game into a lineup. */
export function useNominateGame() {
  const queryClient = useQueryClient();

  return useMutation<
    LineupDetailResponseDto,
    Error,
    { lineupId: number; body: NominateGameDto }
  >({
    mutationFn: ({ lineupId, body }) => nominateGame(lineupId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
      void queryClient.invalidateQueries({ queryKey: [...COMMON_GROUND_KEY] });
    },
  });
}

/** Hook for fetching the lightweight lineup banner. */
export function useLineupBanner() {
  return useQuery<LineupBannerResponseDto | null>({
    queryKey: [...BANNER_KEY],
    queryFn: getLineupBanner,
    staleTime: 120_000,
    retry: false,
  });
}

/** Hook for fetching full lineup detail by ID. */
export function useLineupDetail(id: number | undefined) {
  return useQuery<LineupDetailResponseDto>({
    queryKey: [...DETAIL_KEY, id],
    queryFn: () => getLineupById(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Hook for removing a nomination from a lineup. */
export function useRemoveNomination() {
  const qc = useQueryClient();

  return useMutation<
    void,
    Error,
    { lineupId: number; gameId: number }
  >({
    mutationFn: ({ lineupId, gameId }) => removeNomination(lineupId, gameId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

/** Hook for creating a new lineup. */
export function useCreateLineup() {
  const qc = useQueryClient();

  return useMutation<
    LineupDetailResponseDto,
    Error,
    CreateLineupParams
  >({
    mutationFn: (params) => createLineup(params),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

/** Hook for toggling a vote on a nominated game (ROK-936). */
export function useToggleVote() {
  const qc = useQueryClient();

  return useMutation<
    LineupDetailResponseDto,
    Error,
    { lineupId: number; gameId: number }
  >({
    mutationFn: ({ lineupId, gameId }) => toggleVote(lineupId, gameId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

/** Hook for updating lineup title/description (ROK-1063). */
export function useUpdateLineupMetadata() {
  const qc = useQueryClient();

  return useMutation<
    LineupDetailResponseDto,
    Error,
    { lineupId: number; body: UpdateLineupMetadataParams }
  >({
    mutationFn: ({ lineupId, body }) => updateLineupMetadata(lineupId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

/** Hook for transitioning a lineup to a new status. */
export function useTransitionLineupStatus() {
  const qc = useQueryClient();

  return useMutation<
    LineupDetailResponseDto,
    Error,
    { lineupId: number; body: { status: string; decidedGameId?: number | null } }
  >({
    mutationFn: ({ lineupId, body }) => transitionLineupStatus(lineupId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

/** Hook for adding invitees to a private lineup (ROK-1065). */
export function useAddLineupInvitees() {
  const qc = useQueryClient();

  return useMutation<
    LineupDetailResponseDto,
    Error,
    { lineupId: number; userIds: number[] }
  >({
    mutationFn: ({ lineupId, userIds }) =>
      addLineupInvitees(lineupId, userIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

/** Hook for removing an invitee from a private lineup (ROK-1065). */
export function useRemoveLineupInvitee() {
  const qc = useQueryClient();

  return useMutation<
    LineupDetailResponseDto,
    Error,
    { lineupId: number; userId: number }
  >({
    mutationFn: ({ lineupId, userId }) =>
      removeLineupInvitee(lineupId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}
