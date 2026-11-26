/**
 * ROK-2352 — LFG group scope on the wire. A group is `(gameId, groupKey)`;
 * `''` is the whole-game group and is sent as NO query string, so every
 * non-grouped game's requests stay byte-identical to before.
 */
import {
    LfgGroupListResponseSchema,
    type LfgGroupListResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** `?group=<key>` for a keyed group, `''` for the whole-game group. */
export function groupQuery(groupKey: string): string {
    return groupKey === '' ? '' : `?group=${encodeURIComponent(groupKey)}`;
}

/**
 * `GET /lfg/:gameId/groups` — the game's groups, `''` first.
 * @param includeCatalogue - Add the adapter's empty groups (the picker).
 */
export async function getLfgGameGroups(
    gameId: number,
    includeCatalogue: boolean,
): Promise<LfgGroupListResponseDto> {
    const qs = includeCatalogue ? '?include=catalogue' : '';
    return fetchApi(`/lfg/${gameId}/groups${qs}`, {}, LfgGroupListResponseSchema);
}
