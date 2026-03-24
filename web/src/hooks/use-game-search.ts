import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchGames } from '../lib/api-client';
import { useDebouncedValue } from './use-debounced-value';

/**
 * Hook for searching games via IGDB API.
 * Includes built-in debouncing (400ms) to prevent rate limit issues.
 * Requires minimum 2 characters to search.
 * Cancels in-flight requests when a new query arrives (ROK-660).
 * Uses keepPreviousData to avoid flickering between queries (ROK-953).
 *
 * @param query - Raw search query (will be debounced internally)
 * @param enabled - Whether the query is enabled
 */
export function useGameSearch(query: string, enabled = true) {
    // Debounce the query to prevent rapid-fire API requests (ROK-161, ROK-953)
    const debouncedQuery = useDebouncedValue(query, 400);

    return useQuery({
        queryKey: ['games', 'search', debouncedQuery],
        queryFn: ({ signal }) => searchGames(debouncedQuery, signal),
        enabled: enabled && debouncedQuery.length >= 2,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
        gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
        placeholderData: keepPreviousData,
    });
}
