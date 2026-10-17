import { useQuery } from '@tanstack/react-query';
import { getMyCharacters, getUserCharacters } from '../lib/api-client';

/**
 * Hook for fetching current user's characters.
 * Optionally filtered by gameId for signup confirmation (ROK-131).
 */
export function useMyCharacters(gameId?: number, enabled = true) {
    return useQuery({
        queryKey: ['me', 'characters', gameId],
        queryFn: () => getMyCharacters(gameId),
        enabled,
    });
}

/**
 * ROK-461: Hook for fetching another user's characters.
 * Used by admin roster assignment to select a character on behalf of a player.
 */
export function useUserCharacters(userId: number | null, gameId?: number) {
    return useQuery({
        queryKey: ['users', userId, 'characters', gameId],
        queryFn: () => getUserCharacters(userId!, gameId),
        enabled: userId != null && userId > 0,
    });
}
