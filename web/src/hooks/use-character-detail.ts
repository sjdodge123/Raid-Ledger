import { useQuery } from '@tanstack/react-query';
import { getCharacterDetail } from '../lib/api-client';
import { unresolvedEquipmentInterval } from './unresolved-equipment-poll';

/**
 * Query hook for fetching a single character's full details (equipment page).
 * ROK-1760: polls while any equipment item is still `resolved:false`, bounded
 * per character (see `unresolved-equipment-poll.ts`).
 */
export function useCharacterDetail(characterId: string | undefined) {
    return useQuery({
        queryKey: ['characters', characterId],
        queryFn: () => getCharacterDetail(characterId!),
        enabled: !!characterId,
        refetchInterval: (query) => (characterId ? unresolvedEquipmentInterval(characterId, query) : false),
    });
}
