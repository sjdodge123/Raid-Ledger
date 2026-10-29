/**
 * ROK-1946 D6/D8 — the Map's scanned-portal layer: the server's latest portal
 * scan of one world, readable by every signed-in viewer of a visible hub. No
 * polling (the scan runs every ~10 min); `retry: false` so a hub 404 lands at
 * once as "no layer".
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ValheimServerPortalsResponseSchema, type ValheimServerPortalsResponse } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { valheimDeathsKey } from './use-valheim-deaths-visible';

export interface ServerPortalsArgs {
    serverId: number;
    worldUid: string;
}

/** `GET /plugins/valheim/armory/servers/:serverId/portals?worldUid=`. */
export function valheimServerPortalsPath({ serverId, worldUid }: ServerPortalsArgs): string {
    const query = new URLSearchParams({ worldUid });
    return `/plugins/valheim/armory/servers/${encodePathSegment(String(serverId))}/portals?${query.toString()}`;
}

/** Same root as the server pins key, so an armory invalidation covers it. */
export function valheimServerPortalsKey({ serverId, worldUid }: ServerPortalsArgs) {
    return [...valheimDeathsKey(serverId), 'server-portals', worldUid] as const;
}

/** The portal layer; fetches only while `enabled` and with a real server. */
export function useValheimServerPortals(
    args: ServerPortalsArgs,
    enabled: boolean,
): UseQueryResult<ValheimServerPortalsResponse> {
    return useQuery<ValheimServerPortalsResponse>({
        queryKey: valheimServerPortalsKey(args),
        queryFn: () => fetchApi(valheimServerPortalsPath(args), {}, ValheimServerPortalsResponseSchema),
        enabled: enabled && args.serverId > 0,
        staleTime: 300_000,
        retry: false,
    });
}
