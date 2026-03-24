/**
 * React Query hooks for Community Lineup features (ROK-934).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  LineupDetailResponseDto,
  LineupBannerResponseDto,
  CommonGroundResponseDto,
  NominateGameDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../lib/api-client';
import {
  getActiveLineup,
  getCommonGround,
  nominateGame,
  getLineupBanner,
  getLineupById,
  removeNomination,
  createLineup,
  transitionLineupStatus,
} from '../lib/api-client';
import type { CreateLineupParams } from '../lib/api/lineups-api';

/** Query key for the active lineup. */
const ACTIVE_LINEUP_KEY = ['lineups', 'active'] as const;
/** Query key for the banner. */
const BANNER_KEY = ['lineups', 'banner'] as const;
/** Query key prefix for lineup detail queries. */
const DETAIL_KEY = ['lineups', 'detail'] as const;
/** Query key prefix for common ground queries. */
const COMMON_GROUND_KEY = ['common-ground'] as const;
/** Shared prefix for all lineup query invalidation. */
const LINEUPS_PREFIX = ['lineups'] as const;

/** Hook for fetching the active lineup. */
export function useActiveLineup() {
  return useQuery<LineupDetailResponseDto>({
    queryKey: [...ACTIVE_LINEUP_KEY],
    queryFn: getActiveLineup,
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
