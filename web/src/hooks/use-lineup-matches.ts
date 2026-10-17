/**
 * React Query hooks for Community Lineup Matches (ROK-989).
 * Provides data fetching for the decided view's tiered match cards.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  GroupedMatchesResponseDto,
  BandwagonJoinResponseDto,
  MatchDetailResponseDto,
} from '@raid-ledger/contract';
import {
  getLineupMatches,
  joinMatch,
  advanceMatch,
} from '../lib/api-client';

/** Query key prefix for lineup match queries. */
const MATCHES_KEY = ['lineups', 'matches'] as const;
/** Shared prefix for all lineup query invalidation. */
const LINEUPS_PREFIX = ['lineups'] as const;

/** Hook for fetching grouped matches for a lineup's decided view. */
export function useLineupMatches(lineupId: number | undefined) {
  return useQuery<GroupedMatchesResponseDto>({
    queryKey: [...MATCHES_KEY, lineupId],
    queryFn: () => getLineupMatches(lineupId!),
    enabled: !!lineupId,
    staleTime: 30_000,
  });
}

/** Hook for bandwagon joining a match group. Silent refetch on success. */
export function useBandwagonJoin() {
  const qc = useQueryClient();

  return useMutation<
    BandwagonJoinResponseDto,
    Error,
    { lineupId: number; matchId: number }
  >({
    mutationFn: ({ lineupId, matchId }) => joinMatch(lineupId, matchId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

/** Hook for operator advancing a match to the next tier. */
export function useAdvanceMatch() {
  const qc = useQueryClient();

  return useMutation<
    MatchDetailResponseDto,
    Error,
    { lineupId: number; matchId: number }
  >({
    mutationFn: ({ lineupId, matchId }) => advanceMatch(lineupId, matchId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}
