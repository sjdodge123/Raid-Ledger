import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GameInterestResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

const getHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getAuthToken() || ''}`,
});

/**
 * Hook for want-to-play toggle with optimistic updates.
 */
export function useWantToPlay(gameId: number | undefined) {
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
        enabled: !!gameId && !!getAuthToken(),
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
            // Optimistic update
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
            // Rollback on error
            if ((context as { previous?: GameInterestResponseDto })?.previous) {
                queryClient.setQueryData(
                    queryKey,
                    (context as { previous: GameInterestResponseDto }).previous,
                );
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey });
            // Also invalidate discover so community row updates
            queryClient.invalidateQueries({
                queryKey: ['games', 'discover'],
            });
            // Invalidate hearted games so wizard character steps update in real-time
            queryClient.invalidateQueries({
                queryKey: ['userHeartedGames'],
            });
        },
    });

    return {
        wantToPlay: interest.data?.wantToPlay ?? false,
        count: interest.data?.count ?? 0,
        players: interest.data?.players ?? [],
        isLoading: interest.isLoading,
        toggle: (wantToPlay: boolean) => toggle.mutate(wantToPlay),
        isToggling: toggle.isPending,
    };
}
