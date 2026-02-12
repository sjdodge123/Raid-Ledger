import { useQuery } from '@tanstack/react-query';
import { getPlayers } from '../lib/api-client';

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
