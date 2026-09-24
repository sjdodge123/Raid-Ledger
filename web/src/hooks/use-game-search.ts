import { useEffect, useRef } from 'react';
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
    // newer ones. Cancel this instance's own superseded term when it changes.
    // ROK-1682: scoped to THIS instance's previous term — never other terms
    // app-wide. A closed NominateModal mounting `useGameSearch('')` used to
    // cancel the /games page's in-flight search, leaving it idle with no data.
    const previousQuery = useRef(debouncedQuery);
    useEffect(() => {
        const superseded = previousQuery.current;
        previousQuery.current = debouncedQuery;
        if (superseded === debouncedQuery) return;
        queryClient.cancelQueries({ queryKey: ['games', 'search', superseded] });
    }, [debouncedQuery, queryClient]);

    return useQuery({
        // ROK-1314: viewer appended LAST on purpose — the ROK-1233 cancel
        // above matches the ['games','search',term] prefix.
        queryKey: ['games', 'search', debouncedQuery, viewer],
        queryFn: ({ signal }) => searchGames(debouncedQuery, signal),
        enabled: enabled && debouncedQuery.length >= 2,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
        gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
        placeholderData: keepPreviousData,
    });
}
