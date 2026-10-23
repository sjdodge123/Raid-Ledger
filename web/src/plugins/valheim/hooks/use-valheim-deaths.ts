/**
 * ROK-1930 — the hub Deaths widget's data: per-player death counts on one
 * Pelican server. The route answers 404 to visitors (D6), so an error simply
 * hides the card (the probe below is false on error and while pending).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ValheimDeathsResponseSchema, type ValheimDeathsResponse } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { valheimArmoryKeys } from '../lib/valheim-armory-api';

/** Query key for one server's death counts. */
export const valheimDeathsKey = (serverId: number) =>
    [...valheimArmoryKeys.all, 'deaths', serverId] as const;

/** `GET /plugins/valheim/armory/servers/:serverId/deaths`. */
export function useValheimDeaths(serverId: number): UseQueryResult<ValheimDeathsResponse> {
    return useQuery<ValheimDeathsResponse>({
        queryKey: valheimDeathsKey(serverId),
        queryFn: () => fetchApi(
            `/plugins/valheim/armory/servers/${encodePathSegment(String(serverId))}/deaths`,
            {},
            ValheimDeathsResponseSchema,
        ),
        enabled: serverId > 0,
        retry: false,
    });
}

/** The Overview card's `useVisible` probe: a server hub with at least one recorded death. */
export function useDeathsWidgetVisible(ctx: HubWidgetCtx): boolean {
    const serverId = ctx.page.server?.pelicanServerId ?? 0;
    const { data } = useValheimDeaths(serverId);
    return serverId > 0 && (data?.players.length ?? 0) > 0;
}
