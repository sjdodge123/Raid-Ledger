import { useQuery } from '@tanstack/react-query';
import { getPlayers, getRecentPlayers } from '../lib/api-client';
import { useInfiniteList } from './use-infinite-list';
import type { UserPreviewDto } from '@raid-ledger/contract';

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

/** Params for the infinite players query (ROK-821). */
export interface InfinitePlayersParams {
    search?: string;
    gameId?: number;
    sources?: string;
    role?: string;
    playtimeMin?: number;
    playHistory?: string;
}

/**
 * Infinite-scroll variant of usePlayers (ROK-361, ROK-821: params object).
 */
export function useInfinitePlayers(search: string, params?: InfinitePlayersParams) {
    return useInfiniteList<UserPreviewDto>({
        queryKey: ['players', 'infinite', search, params],
        queryFn: (page) =>
            getPlayers({
                page,
                search: search || undefined,
                ...params,
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
