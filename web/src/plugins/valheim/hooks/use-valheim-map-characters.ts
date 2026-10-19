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

/** The list route's page cap (`pageSize` ≤ 100, `page` from 1). */
export const CHARACTER_PAGE_SIZE = 100;
/** Safety stop: 50 pages = 5,000 characters on one server. */
const MAX_CHARACTER_PAGES = 50;

/** Walk the list route page by page until a short page (no `total` in the contract). */
export async function fetchAllServerCharacters(
    serverId: number,
): Promise<ValheimCharacterSummary[]> {
    const rows: ValheimCharacterSummary[] = [];
    for (let page = 1; page <= MAX_CHARACTER_PAGES; page++) {
        const { data } = await fetchApi(
            `${CHARACTERS_PATH}?serverId=${serverId}&page=${page}&pageSize=${CHARACTER_PAGE_SIZE}`,
            {},
            ValheimCharacterListResponseSchema,
        );
        rows.push(...data);
        if (data.length < CHARACTER_PAGE_SIZE) break;
    }
    return rows;
}

/** Every character on one Pelican server (all pages). */
export function useValheimServerCharacters(
    serverId: number,
): UseQueryResult<ValheimCharacterSummary[]> {
    return useQuery<ValheimCharacterSummary[]>({
        queryKey: ['valheim', 'armory', 'characters', serverId],
        queryFn: () => fetchAllServerCharacters(serverId),
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
