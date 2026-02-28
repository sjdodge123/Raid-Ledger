import { useContext } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GameInterestResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import { WantToPlayContext, NO_PROVIDER } from './want-to-play-context';

const getHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getAuthToken() || ''}`,
});

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
function useWantToPlayIndividual(gameId: number | undefined, enabled: boolean) {
    const queryClient = useQueryClient();
    const queryKey = ['games', 'interest', gameId];

    const interest = useQuery<GameInterestResponseDto>({
        queryKey,
        queryFn: async () => {
            const response = await fetch(
                `${API_BASE_URL}/games/${gameId}/interest`,
                { headers: getHeaders() },
            );
            if (!response.ok) throw new Error('Failed to fetch interest');
            return response.json();
        },
        enabled: enabled && !!gameId && !!getAuthToken(),
        staleTime: 1000 * 60 * 5,
    });

    const toggle = useMutation<GameInterestResponseDto, Error, boolean>({
        mutationFn: async (wantToPlay: boolean) => {
            const method = wantToPlay ? 'POST' : 'DELETE';
            const response = await fetch(
                `${API_BASE_URL}/games/${gameId}/want-to-play`,
                { method, headers: getHeaders() },
            );
            if (!response.ok) throw new Error('Failed to update interest');
            return response.json();
        },
        onMutate: async (wantToPlay) => {
            await queryClient.cancelQueries({ queryKey });
            const previous =
                queryClient.getQueryData<GameInterestResponseDto>(queryKey);

            queryClient.setQueryData<GameInterestResponseDto>(queryKey, (old) => ({
                wantToPlay,
                count: (old?.count ?? 0) + (wantToPlay ? 1 : -1),
            }));

            return { previous };
        },
        onError: (_err, _vars, context) => {
            if ((context as { previous?: GameInterestResponseDto })?.previous) {
                queryClient.setQueryData(
                    queryKey,
                    (context as { previous: GameInterestResponseDto }).previous,
                );
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({
                queryKey: ['games', 'discover'],
            });
            queryClient.invalidateQueries({
                queryKey: ['userHeartedGames'],
            });
        },
    });

    return {
        wantToPlay: interest.data?.wantToPlay ?? false,
        count: interest.data?.count ?? 0,
        source: interest.data?.source,
        players: interest.data?.players ?? [],
        isLoading: interest.isLoading,
        toggle: (wantToPlay: boolean) => toggle.mutate(wantToPlay),
        isToggling: toggle.isPending,
    };
}
