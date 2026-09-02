import { useEffect } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { searchGames } from '../lib/api-client';
import { useViewerCacheScope } from './use-auth';
import { useDebouncedValue } from './use-debounced-value';

/**
 * Hook for searching games via IGDB API.
 * Includes built-in debouncing (400ms) to prevent rate limit issues.
 * Requires minimum 2 characters to search.
 * Cancels in-flight requests when a new query arrives (ROK-660, ROK-1233).
 * Uses keepPreviousData to avoid flickering between queries (ROK-953).
 *
 * @param query - Raw search query (will be debounced internally)
 * @param enabled - Whether the query is enabled
 */
export function useGameSearch(query: string, enabled = true) {
    // Debounce the query to prevent rapid-fire API requests (ROK-161, ROK-953)
    const debouncedQuery = useDebouncedValue(query, 400);
    const queryClient = useQueryClient();
    const viewer = useViewerCacheScope();

    // ROK-1233: TanStack Query only fires AbortSignal for re-fetches of the
    // SAME queryKey. Superseded prefixes (e.g. `q=return` after the user keeps
    // typing `q=return to moria`) sit in the cache and run to completion —
    // wasting an IGDB call and creating races where stale results arrive after
    // newer ones. Cancel any in-flight `/games/search` queries whose term is
    // not the current debounced term.
    useEffect(() => {
        queryClient.cancelQueries({
            queryKey: ['games', 'search'],
            predicate: (q) => q.queryKey[2] !== debouncedQuery,
        });
    }, [debouncedQuery, queryClient]);

    return useQuery({
        // ROK-1314: viewer appended LAST on purpose — the ROK-1233 cancel
        // predicate above reads queryKey[2] as the search term.
        queryKey: ['games', 'search', debouncedQuery, viewer],
        queryFn: ({ signal }) => searchGames(debouncedQuery, signal),
        enabled: enabled && debouncedQuery.length >= 2,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
        gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
        placeholderData: keepPreviousData,
    });
}
