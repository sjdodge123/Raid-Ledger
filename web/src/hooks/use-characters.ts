import { useQuery } from '@tanstack/react-query';
import { getMyCharacters, getUserCharacters } from '../lib/api-client';

/** Per-caller query tuning for {@link useMyCharacters}. */
export interface MyCharactersOptions {
    /** Retries on a failed load (default: the client's). A caller that gates a UI on the load passes 1. */
    retry?: number;
}

/**
 * Hook for fetching current user's characters.
 * Optionally filtered by gameId for signup confirmation (ROK-131).
 */
export function useMyCharacters(gameId?: number, enabled = true, options: MyCharactersOptions = {}) {
    return useQuery({
        queryKey: ['me', 'characters', gameId],
        queryFn: () => getMyCharacters(gameId),
        enabled,
        ...options,
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
