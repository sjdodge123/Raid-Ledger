/**
 * ROK-1837 — the Map tab's pickers: the server's characters (list route) and
 * one character's maps (detail route). A small local client so the lazy tab
 * chunk does not wait on ROK-1836's armory hooks (sibling branch).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
    ValheimCharacterDetailSchema,
    ValheimCharacterListResponseSchema,
    type ValheimCharacterDetail,
    type ValheimCharacterSummary,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';

const CHARACTERS_PATH = '/plugins/valheim/armory/characters';

/** Every character on one Pelican server (first 100 — the page cap). */
export function useValheimServerCharacters(
    serverId: number,
): UseQueryResult<ValheimCharacterSummary[]> {
    return useQuery<ValheimCharacterSummary[]>({
        queryKey: ['valheim', 'armory', 'characters', serverId],
        queryFn: async () =>
            (
                await fetchApi(
                    `${CHARACTERS_PATH}?serverId=${serverId}&pageSize=100`,
                    {},
                    ValheimCharacterListResponseSchema,
                )
            ).data,
        retry: false,
    });
}

/** One character's detail — the map tab reads its `maps`. */
export function useValheimCharacterMaps(
    characterId: number | null,
): UseQueryResult<ValheimCharacterDetail> {
    return useQuery<ValheimCharacterDetail>({
        queryKey: ['valheim', 'armory', 'character', characterId],
        queryFn: () =>
            fetchApi(
                `${CHARACTERS_PATH}/${encodePathSegment(String(characterId ?? 0))}`,
                {},
                ValheimCharacterDetailSchema,
            ),
        enabled: characterId !== null,
        retry: false,
    });
}
