import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
    const viewer = useViewerCacheScope();

    // ROK-1233 supersession: when the debounced term changes, the observer
    // leaves the old term's query. TanStack cancels a query whose LAST
    // observer leaves while its AbortSignal was consumed (queryFn takes
    // `signal`), so a superseded IGDB call is aborted without a manual
    // cancelQueries. ROK-1682: that manual cancel was removed — it aborted
    // queries other instances were still showing (the /games page's search
    // when a NominateModal mounted, closed or typed on), leaving them idle
    // with no data. Library cancellation only fires once nobody observes it.
    return useQuery({
        // ROK-1314: viewer appended LAST — keeps ['games','search',term] a
        // usable prefix for callers that match on the term.
        queryKey: ['games', 'search', debouncedQuery, viewer],
        queryFn: ({ signal }) => searchGames(debouncedQuery, signal),
        enabled: enabled && debouncedQuery.length >= 2,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
        gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
        placeholderData: keepPreviousData,
    });
}
