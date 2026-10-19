/**
 * ROK-1836 — Valheim armory read client: paths, query keys and the
 * shape-locked fetchers for the member list + character sheet (ROK-1835
 * routes, ROK-1836 `items`/`atlas` additions) and the member blob route.
 */
import {
    ValheimCharacterDetailSchema,
    ValheimCharacterListResponseSchema,
    type ValheimCharacterDetail,
    type ValheimCharacterListResponse,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';

export const VALHEIM_ARMORY_PATH = '/plugins/valheim/armory';
export const VALHEIM_CHARACTERS_PAGE_SIZE = 50;

export const valheimArmoryKeys = {
    all: ['plugins', 'valheim', 'armory'] as const,
    list: (serverId: number, page: number) =>
        [...valheimArmoryKeys.all, 'characters', serverId, page] as const,
    detail: (id: number) =>
        [...valheimArmoryKeys.all, 'character', id] as const,
    blob: (serverId: number, sha256: string) =>
        [...valheimArmoryKeys.all, 'blob', serverId, sha256] as const,
};

/** `GET …/characters?serverId&page&pageSize` — one page of a server's characters. */
export function valheimCharactersPath(
    serverId: number,
    page: number,
    pageSize = VALHEIM_CHARACTERS_PAGE_SIZE,
): string {
    const q = new URLSearchParams({
        serverId: String(serverId),
        page: String(page),
        pageSize: String(pageSize),
    });
    return `${VALHEIM_ARMORY_PATH}/characters?${q.toString()}`;
}

/** `GET …/characters/:id`. */
export function valheimCharacterPath(id: number): string {
    return `${VALHEIM_ARMORY_PATH}/characters/${encodePathSegment(String(id))}`;
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * `GET …/servers/:serverId/blobs/:sha256` (D5). Content-addressed, so only a
 * lowercase hex sha256 is accepted — anything else throws rather than
 * becoming a path. The route is bearer-JWT only: an `<img src>` / CSS `url()`
 * cannot carry the header, so render through `useValheimBlobUrl` (hooks/use-valheim-characters).
 */
export function valheimBlobPath(serverId: number, sha256: string): string {
    if (!Number.isInteger(serverId) || serverId <= 0)
        throw new Error('Invalid server id');
    if (!SHA256.test(sha256)) throw new Error('Invalid blob hash');
    return `${VALHEIM_ARMORY_PATH}/servers/${serverId}/blobs/${sha256}`;
}

export function fetchValheimCharacters(
    serverId: number,
    page: number,
): Promise<ValheimCharacterListResponse> {
    return fetchApi(
        valheimCharactersPath(serverId, page),
        {},
        ValheimCharacterListResponseSchema,
    );
}

export function fetchValheimCharacter(
    id: number,
): Promise<ValheimCharacterDetail> {
    return fetchApi(valheimCharacterPath(id), {}, ValheimCharacterDetailSchema);
}

/** True when a query error is the API's 404 (unknown / foreign character). */
export function isNotFoundError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 404
    );
}
