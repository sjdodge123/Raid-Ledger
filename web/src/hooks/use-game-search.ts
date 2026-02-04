import { useQuery } from '@tanstack/react-query';
import { searchGames } from '../lib/api-client';

/**
 * Hook for searching games via IGDB API.
 * Debounced query with minimum 2 characters.
 */
export function useGameSearch(query: string, enabled = true) {
    return useQuery({
        queryKey: ['games', 'search', query],
        queryFn: () => searchGames(query),
        enabled: enabled && query.length >= 2,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
        gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
    });
}
