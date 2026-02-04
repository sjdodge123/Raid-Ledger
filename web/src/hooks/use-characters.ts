import { useQuery } from '@tanstack/react-query';
import { getMyCharacters } from '../lib/api-client';

/**
 * Hook for fetching current user's characters.
 * Optionally filtered by gameId for signup confirmation (ROK-131).
 */
export function useMyCharacters(gameId?: string, enabled = true) {
    return useQuery({
        queryKey: ['me', 'characters', gameId],
        queryFn: () => getMyCharacters(gameId),
        enabled,
    });
}
