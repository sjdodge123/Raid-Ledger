/**
 * React Query hooks for tiebreaker operations (ROK-938).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TiebreakerDetailDto } from '@raid-ledger/contract';
import {
    getTiebreakerDetail,
    startTiebreaker,
    dismissTiebreaker,
    castBracketVote,
    castVeto,
    forceResolveTiebreaker,
} from '../lib/api/tiebreaker-api';

const TIEBREAKER_KEY = ['tiebreaker'] as const;
const LINEUPS_PREFIX = ['lineups'] as const;

/** Fetch tiebreaker detail for a lineup. */
export function useTiebreakerDetail(lineupId: number | undefined) {
    return useQuery<TiebreakerDetailDto | null>({
        queryKey: [...TIEBREAKER_KEY, lineupId],
        queryFn: () => getTiebreakerDetail(lineupId!),
        enabled: !!lineupId,
        staleTime: 10_000,
    });
}

/** Start a tiebreaker. */
export function useStartTiebreaker() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (p: { lineupId: number; mode: 'bracket' | 'veto'; roundDurationHours?: number }) =>
            startTiebreaker(p.lineupId, { mode: p.mode, roundDurationHours: p.roundDurationHours }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
            void qc.invalidateQueries({ queryKey: [...TIEBREAKER_KEY] });
        },
    });
}

/** Dismiss tiebreaker. */
export function useDismissTiebreaker() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (lineupId: number) => dismissTiebreaker(lineupId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
            void qc.invalidateQueries({ queryKey: [...TIEBREAKER_KEY] });
        },
    });
}

/** Cast a bracket vote. */
export function useCastBracketVote() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (p: { lineupId: number; matchupId: number; gameId: number }) =>
            castBracketVote(p.lineupId, { matchupId: p.matchupId, gameId: p.gameId }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: [...TIEBREAKER_KEY] });
        },
    });
}

/** Cast a veto. */
export function useCastVeto() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (p: { lineupId: number; gameId: number }) =>
            castVeto(p.lineupId, { gameId: p.gameId }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: [...TIEBREAKER_KEY] });
        },
    });
}

/** Force-resolve tiebreaker. */
export function useForceResolve() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (lineupId: number) => forceResolveTiebreaker(lineupId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
            void qc.invalidateQueries({ queryKey: [...TIEBREAKER_KEY] });
        },
    });
}
