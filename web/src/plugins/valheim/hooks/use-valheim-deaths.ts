/**
 * ROK-1930 — the hub Deaths widget's data: per-player death counts on one
 * Pelican server. The route answers 404 to visitors (D6), so an error simply
 * hides the card (the probe is false on error and while pending). The probe
 * lives in `use-valheim-deaths-visible.ts` so this schema-bound file stays lazy.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ValheimDeathsResponseSchema, type ValheimDeathsResponse } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { valheimDeathsKey } from './use-valheim-deaths-visible';

export { valheimDeathsKey, useDeathsWidgetVisible } from './use-valheim-deaths-visible';

/** `GET /plugins/valheim/armory/servers/:serverId/deaths`, shape-locked. */
export function fetchValheimDeaths(serverId: number): Promise<ValheimDeathsResponse> {
    return fetchApi(
        `/plugins/valheim/armory/servers/${encodePathSegment(String(serverId))}/deaths`,
        {},
        ValheimDeathsResponseSchema,
    );
}

export function useValheimDeaths(serverId: number): UseQueryResult<ValheimDeathsResponse> {
    return useQuery<ValheimDeathsResponse>({
        queryKey: valheimDeathsKey(serverId),
        queryFn: () => fetchValheimDeaths(serverId),
        enabled: serverId > 0,
        retry: false,
    });
}
