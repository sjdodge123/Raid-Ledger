import { useQuery } from '@tanstack/react-query';
import { getCharacterDetail } from '../lib/api-client';

/**
 * Query hook for fetching a single character's full details (equipment page).
 */
export function useCharacterDetail(characterId: string | undefined) {
    return useQuery({
        queryKey: ['characters', characterId],
        queryFn: () => getCharacterDetail(characterId!),
        enabled: !!characterId,
    });
}
