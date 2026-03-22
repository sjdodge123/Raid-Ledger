/**
 * React Query hooks for Community Lineup features (ROK-934).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  LineupDetailResponseDto,
  CommonGroundResponseDto,
  NominateGameDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../lib/api-client';
import {
  getActiveLineup,
  getCommonGround,
  nominateGame,
} from '../lib/api-client';

/** Query key for the active lineup. */
const ACTIVE_LINEUP_KEY = ['lineups', 'active'] as const;
/** Query key prefix for common ground queries. */
const COMMON_GROUND_KEY = ['common-ground'] as const;

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
      void queryClient.invalidateQueries({ queryKey: [...ACTIVE_LINEUP_KEY] });
      void queryClient.invalidateQueries({ queryKey: [...COMMON_GROUND_KEY] });
    },
  });
}
