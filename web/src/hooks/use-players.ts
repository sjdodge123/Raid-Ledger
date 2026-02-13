import { useQuery } from '@tanstack/react-query';
import { getPlayers, getRecentPlayers } from '../lib/api-client';

/**
 * Query hook for fetching paginated player list.
 * ROK-282: Optional gameId filter.
 */
export function usePlayers(page: number, search: string, gameId?: number) {
    return useQuery({
        queryKey: ['players', page, search, gameId],
        queryFn: () =>
            getPlayers({
                page,
                search: search || undefined,
                gameId,
            }),
    });
}

/**
 * Query hook for fetching recently joined players (ROK-298).
 * Returns up to 10 players who joined in the last 30 days.
 */
export function useRecentPlayers() {
    return useQuery({
        queryKey: ['players', 'recent'],
        queryFn: getRecentPlayers,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}
