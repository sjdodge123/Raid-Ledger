import { useQuery } from '@tanstack/react-query';
import { CharacterQuestsResponseSchema, type CharacterQuestsDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

/**
 * ROK-1745: the quest snapshot for a WoW: Forever character. Only requests for
 * the `wow_forever` variant; `quests` is `null` when the section is hidden.
 */
export function useCharacterQuests(characterId: string, variant: string | null): {
    quests: CharacterQuestsDto | null | undefined;
    isError: boolean;
} {
    const query = useQuery({
        queryKey: ['character-quests', characterId],
        queryFn: () => fetchApi(`/plugins/wow/characters/${characterId}/quests`, {}, CharacterQuestsResponseSchema),
        enabled: variant === 'wow_forever' && !!characterId,
        staleTime: 60_000,
    });
    return { quests: query.data?.quests, isError: query.isError };
}
