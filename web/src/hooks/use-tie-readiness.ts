/**
 * React Query hooks for the tie readiness card (ROK-1374).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
    SetInstallSizeDto,
    TieReadinessResponseDto,
} from '@raid-ledger/contract';
import {
    getTieReadiness,
    pickTieGame,
    undoTiePick,
    setInstallSize,
} from '../lib/api/tie-readiness-api';
import { toast } from '../lib/toast';

export const TIE_READINESS_KEY = ['tie-readiness'] as const;
const TIEBREAKER_PREFIX = ['tiebreaker'] as const;
const LINEUPS_PREFIX = ['lineups'] as const;

/**
 * The readiness card for a lineup, or `null` when no tie hold exists.
 * `staleTime` matches `use-tiebreaker.ts` so the two surfaces refresh alike.
 */
export function useTieReadiness(lineupId: number | undefined) {
    return useQuery<TieReadinessResponseDto | null>({
        queryKey: [...TIE_READINESS_KEY, lineupId],
        queryFn: () => getTieReadiness(lineupId!),
        enabled: !!lineupId,
        staleTime: 10_000,
    });
}

/** Invalidate every surface a tie mutation can move. */
function useTieInvalidation(lineupId: number) {
    const qc = useQueryClient();
    return (): void => {
        void qc.invalidateQueries({ queryKey: [...TIEBREAKER_PREFIX] });
        void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
        void qc.invalidateQueries({ queryKey: [...TIE_READINESS_KEY, lineupId] });
    };
}

/** Pick one of the tied games. */
export function usePickTieGame(lineupId: number) {
    const invalidate = useTieInvalidation(lineupId);
    return useMutation({
        mutationFn: (gameId: number) => pickTieGame(lineupId, { gameId }),
        onSuccess: invalidate,
        onError: (err: Error) => {
            toast.error(err.message || 'Could not record that pick');
        },
    });
}

/** Undo a pick while the grace claim is still pending. */
export function useUndoTiePick(lineupId: number) {
    const invalidate = useTieInvalidation(lineupId);
    return useMutation({
        mutationFn: () => undoTiePick(lineupId),
        onSuccess: invalidate,
        onError: (err: Error) => {
            toast.error(err.message || 'Could not undo that pick');
        },
    });
}

/** Record a game's footprint from the size modal. */
export function useSetInstallSize(lineupId: number) {
    const invalidate = useTieInvalidation(lineupId);
    return useMutation({
        mutationFn: (p: { gameId: number; body: SetInstallSizeDto }) =>
            setInstallSize(p.gameId, p.body),
        onSuccess: invalidate,
        onError: (err: Error) => {
            toast.error(err.message || 'Could not save that size');
        },
    });
}
