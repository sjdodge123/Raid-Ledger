/**
 * ROK-1930 L4 — the Map tab's "Show all" layer: every player's Death pins on one
 * world of one Pelican server. `worldUid` is the selected map's int64 string;
 * the route answers 404 to visitors (D6) and the view then draws nothing.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ValheimDeathPinsResponseSchema, type ValheimDeathPinsResponse } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { valheimDeathsKey } from './use-valheim-deaths-visible';

/** `GET /plugins/valheim/armory/servers/:serverId/deaths/pins?worldUid=<uid>`. */
export function valheimDeathPinsPath(serverId: number, worldUid: string): string {
    const query = new URLSearchParams({ worldUid }).toString();
    return `/plugins/valheim/armory/servers/${encodePathSegment(String(serverId))}/deaths/pins?${query}`;
}

export function useValheimDeathPins(
    serverId: number,
    worldUid: string,
    enabled: boolean,
): UseQueryResult<ValheimDeathPinsResponse> {
    return useQuery<ValheimDeathPinsResponse>({
        queryKey: [...valheimDeathsKey(serverId), 'pins', worldUid],
        queryFn: () => fetchApi(valheimDeathPinsPath(serverId, worldUid), {}, ValheimDeathPinsResponseSchema),
        enabled: enabled && serverId > 0,
        retry: false,
    });
}
