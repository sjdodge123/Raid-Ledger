import { useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GameInterestResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import {
    WantToPlayContext,
    defaultEntry,
    type WantToPlayContextValue,
} from './want-to-play-context';

const getHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getAuthToken() || ''}`,
});

interface BatchInterestData {
    data: Record<string, { wantToPlay: boolean; count: number }>;
}

interface WantToPlayProviderProps {
    gameIds: number[];
    children: ReactNode;
}

/**
 * ROK-362: Batch want-to-play provider.
 * Fetches interest status for all provided game IDs in a single request,
 * then provides per-game interest data via context.
 */
export function WantToPlayProvider({ gameIds, children }: WantToPlayProviderProps) {
    const queryClient = useQueryClient();
    const token = getAuthToken();

    // Deduplicate and sort for stable query key
    const sortedIds = useMemo(() => {
        const unique = [...new Set(gameIds.filter((id) => id > 0))];
        unique.sort((a, b) => a - b);
        return unique;
    }, [gameIds]);

    const queryKey = useMemo(
        () => ['games', 'interest', 'batch', sortedIds],
        [sortedIds],
    );

    const { data: batchData } = useQuery<BatchInterestData>({
        queryKey,
        queryFn: async () => {
            if (sortedIds.length === 0) return { data: {} };
            const response = await fetch(
                `${API_BASE_URL}/games/interest/batch?ids=${sortedIds.join(',')}`,
                { headers: getHeaders() },
            );
            if (!response.ok) throw new Error('Failed to fetch batch interest');
            return response.json();
        },
        enabled: sortedIds.length > 0 && !!token,
        staleTime: 1000 * 60 * 5,
    });

    const toggleMutation = useMutation<GameInterestResponseDto, Error, { gameId: number; wantToPlay: boolean }>({
        mutationFn: async ({ gameId, wantToPlay }) => {
            const method = wantToPlay ? 'POST' : 'DELETE';
            const response = await fetch(
                `${API_BASE_URL}/games/${gameId}/want-to-play`,
                { method, headers: getHeaders() },
            );
            if (!response.ok) throw new Error('Failed to update interest');
            return response.json();
        },
        onMutate: async ({ gameId, wantToPlay }) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<BatchInterestData>(queryKey);

            // Optimistic update in the batch cache
            queryClient.setQueryData<BatchInterestData>(queryKey, (old) => {
                if (!old) return old;
                const key = String(gameId);
                const existing = old.data[key] ?? defaultEntry;
                return {
                    data: {
                        ...old.data,
                        [key]: {
                            wantToPlay,
                            count: Math.max(0, existing.count + (wantToPlay ? 1 : -1)),
                        },
                    },
                };
            });

            // Also optimistically update individual query cache (for game detail page)
            const individualKey = ['games', 'interest', gameId];
            queryClient.setQueryData<GameInterestResponseDto>(individualKey, (old) => ({
                wantToPlay,
                count: Math.max(0, (old?.count ?? 0) + (wantToPlay ? 1 : -1)),
            }));

            return { previous };
        },
        onError: (_err, _vars, context) => {
            if ((context as { previous?: BatchInterestData })?.previous) {
                queryClient.setQueryData(
                    queryKey,
                    (context as { previous: BatchInterestData }).previous,
                );
            }
        },
        onSettled: (_data, _err, vars) => {
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({ queryKey: ['games', 'interest', vars.gameId] });
            queryClient.invalidateQueries({ queryKey: ['games', 'discover'] });
            queryClient.invalidateQueries({ queryKey: ['userHeartedGames'] });
        },
    });

    const value = useMemo<WantToPlayContextValue>(() => ({
        getInterest: (gameId: number) => {
            return batchData?.data[String(gameId)] ?? defaultEntry;
        },
        toggle: (gameId: number, wantToPlay: boolean) => {
            toggleMutation.mutate({ gameId, wantToPlay });
        },
        isToggling: toggleMutation.isPending,
    }), [batchData, toggleMutation]);

    return (
        <WantToPlayContext.Provider value={value}>
            {children}
        </WantToPlayContext.Provider>
    );
}
