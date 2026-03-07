import { useMemo, useCallback, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GameInterestResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { toast } from '../lib/toast';
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
function optimisticBatchUpdate(
    queryClient: ReturnType<typeof useQueryClient>,
    queryKey: unknown[],
    gameId: number,
    wantToPlay: boolean,
) {
    queryClient.setQueryData<BatchInterestData>(queryKey, (old) => {
        if (!old) return old;
        const key = String(gameId);
        const existing = old.data[key] ?? defaultEntry;
        return { data: { ...old.data, [key]: { wantToPlay, count: Math.max(0, existing.count + (wantToPlay ? 1 : -1)) } } };
    });
    queryClient.setQueryData<GameInterestResponseDto>(['games', 'interest', gameId], (old) => ({
        wantToPlay,
        count: Math.max(0, (old?.count ?? 0) + (wantToPlay ? 1 : -1)),
    }));
}

async function toggleInterestFn({ gameId, wantToPlay }: { gameId: number; wantToPlay: boolean }): Promise<GameInterestResponseDto> {
    const response = await fetch(`${API_BASE_URL}/games/${gameId}/want-to-play`, { method: wantToPlay ? 'POST' : 'DELETE', headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to update interest');
    return response.json();
}

function handleToggleSettled(
    queryClient: ReturnType<typeof useQueryClient>,
    queryKey: unknown[],
    setTogglingIds: React.Dispatch<React.SetStateAction<Set<number>>>,
    vars: { gameId: number },
) {
    setTogglingIds((prev) => { const next = new Set(prev); next.delete(vars.gameId); return next; });
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['games', 'interest', vars.gameId] });
    queryClient.invalidateQueries({ queryKey: ['userHeartedGames'] });
}

function useToggleInterestMutation(
    queryKey: unknown[],
    setTogglingIds: React.Dispatch<React.SetStateAction<Set<number>>>,
) {
    const queryClient = useQueryClient();

    return useMutation<GameInterestResponseDto, Error, { gameId: number; wantToPlay: boolean }>({
        mutationFn: toggleInterestFn,
        onMutate: async ({ gameId, wantToPlay }) => {
            setTogglingIds((prev) => new Set(prev).add(gameId));
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<BatchInterestData>(queryKey);
            optimisticBatchUpdate(queryClient, queryKey, gameId, wantToPlay);
            return { previous };
        },
        onError: (_err, vars, context) => {
            const prev = (context as { previous?: BatchInterestData })?.previous;
            if (prev) queryClient.setQueryData(queryKey, prev);
            queryClient.invalidateQueries({ queryKey: ['games', 'interest', vars.gameId] });
            toast.error('Failed to update game interest');
        },
        onSettled: (_data, _err, vars) => handleToggleSettled(queryClient, queryKey, setTogglingIds, vars),
    });
}

function useSortedGameIds(gameIds: number[]) {
    return useMemo(() => {
        const unique = [...new Set(gameIds.filter((id) => id > 0))];
        unique.sort((a, b) => a - b);
        return unique;
    }, [gameIds]);
}

function useBatchInterest(sortedIds: number[], queryKey: unknown[]) {
    const token = getAuthToken();
    return useQuery<BatchInterestData>({
        queryKey,
        queryFn: async () => {
            if (sortedIds.length === 0) return { data: {} };
            const response = await fetch(`${API_BASE_URL}/games/interest/batch?ids=${sortedIds.join(',')}`, { headers: getHeaders() });
            if (!response.ok) throw new Error('Failed to fetch batch interest');
            return response.json();
        },
        enabled: sortedIds.length > 0 && !!token,
        staleTime: 1000 * 60 * 5,
    });
}

export function WantToPlayProvider({ gameIds, children }: WantToPlayProviderProps) {
    const sortedIds = useSortedGameIds(gameIds);
    const queryKey = useMemo(() => ['games', 'interest', 'batch', sortedIds], [sortedIds]);
    const { data: batchData } = useBatchInterest(sortedIds, queryKey);

    const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
    const toggleMutation = useToggleInterestMutation(queryKey, setTogglingIds);
    const toggle = useCallback((gameId: number, wantToPlay: boolean) => { toggleMutation.mutate({ gameId, wantToPlay }); }, [toggleMutation]);

    const value = useMemo<WantToPlayContextValue>(() => ({
        getInterest: (gameId: number) => batchData?.data[String(gameId)] ?? defaultEntry, toggle, togglingIds,
    }), [batchData, toggle, togglingIds]);

    return <WantToPlayContext.Provider value={value}>{children}</WantToPlayContext.Provider>;
}
