import { useQuery } from '@tanstack/react-query';
import { getPlayers } from '../lib/api-client';

/**
 * Query hook for fetching paginated player list.
 */
export function usePlayers(page: number, search: string) {
    return useQuery({
        queryKey: ['players', page, search],
        queryFn: () => getPlayers({ page, search: search || undefined }),
    });
}
