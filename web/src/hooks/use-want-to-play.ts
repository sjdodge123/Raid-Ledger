import { useContext } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GameInterestResponseDto } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';
import { toast } from '../lib/toast';
import { getAuthToken } from './use-auth';
import { WantToPlayContext, NO_PROVIDER } from './want-to-play-context';

/**
 * Hook for want-to-play toggle with optimistic updates.
 *
 * ROK-362: When inside a WantToPlayProvider, reads from batch context
 * instead of making individual requests. Falls back to individual
 * queries when no provider is present (e.g., game detail page).
 */
export function useWantToPlay(gameId: number | undefined) {
    const ctx = useContext(WantToPlayContext);
    const inBatch = ctx !== NO_PROVIDER;

    // Always call the individual hook (React rules), but disable it when in batch mode
    const individual = useWantToPlayIndividual(gameId, !inBatch);

    if (inBatch && gameId) {
        const interest = ctx.getInterest(gameId);
        return {
            wantToPlay: interest.wantToPlay,
            count: interest.count,
            source: interest.source,
            players: [],
            owners: [],
            ownerCount: 0,
            wishlisters: [],
            wishlistedCount: 0,
            isLoading: false,
            toggle: (wantToPlay: boolean) => ctx.toggle(gameId, wantToPlay),
            isToggling: ctx.togglingIds.has(gameId),
        };
    }

    return individual;
}

/**
 * Individual (non-batch) want-to-play hook. Always called to satisfy
 * React hook rules, but disabled when `enabled` is false.
 */
function useInterestToggleMutation(gameId: number | undefined) {
    const queryClient = useQueryClient();
    const queryKey = ['games', 'interest', gameId];

    return useMutation<GameInterestResponseDto, Error, boolean>({
        mutationFn: (wantToPlay: boolean) =>
            fetchApi<GameInterestResponseDto>(`/games/${gameId}/want-to-play`, {
                method: wantToPlay ? 'POST' : 'DELETE',
            }),
        onMutate: async (wantToPlay) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<GameInterestResponseDto>(queryKey);
            queryClient.setQueryData<GameInterestResponseDto>(queryKey, (old) => ({
                wantToPlay, count: (old?.count ?? 0) + (wantToPlay ? 1 : -1),
            }));
            return { previous };
        },
        onError: (_err, _vars, context) => {
            const prev = (context as { previous?: GameInterestResponseDto })?.previous;
            if (prev) queryClient.setQueryData(queryKey, prev);
            toast.error('Failed to update game interest');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({ queryKey: ['userHeartedGames'] });
            // ROK-1311: also invalidate the batch cache consumed by /games card lists.
            // Prefix match invalidates every ['games', 'interest', 'batch', sortedIds] entry.
            queryClient.invalidateQueries({ queryKey: ['games', 'interest', 'batch'] });
        },
    });
}

function useWantToPlayIndividual(gameId: number | undefined, enabled: boolean) {
    const interest = useQuery<GameInterestResponseDto>({
        queryKey: ['games', 'interest', gameId],
        queryFn: () =>
            fetchApi<GameInterestResponseDto>(`/games/${gameId}/interest`),
        enabled: enabled && !!gameId && !!getAuthToken(),
        staleTime: 1000 * 60 * 5,
    });

    const toggle = useInterestToggleMutation(gameId);

    return {
        wantToPlay: interest.data?.wantToPlay ?? false,
        count: interest.data?.count ?? 0,
        source: interest.data?.source,
        players: interest.data?.players ?? [],
        owners: interest.data?.owners ?? [],
        ownerCount: interest.data?.ownerCount ?? 0,
        wishlisters: interest.data?.wishlisters ?? [],
        wishlistedCount: interest.data?.wishlistedCount ?? 0,
        isLoading: interest.isLoading,
        toggle: (wantToPlay: boolean) => toggle.mutate(wantToPlay),
        isToggling: toggle.isPending,
    };
}
