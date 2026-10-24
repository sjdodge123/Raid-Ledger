/**
 * ROK-1943 D1/D4 — the Map pin filter's cross-player layer: every chosen
 * player's own pins on one world of one Pelican server. The route answers 404
 * to visitors (D2); `retry: false` so that lands at once as the member hint.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ValheimServerPinsResponseSchema, type ValheimServerPinsResponse } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { valheimDeathsKey } from './use-valheim-deaths-visible';

export interface ServerPinsArgs {
    serverId: number;
    worldUid: string;
    /** `'all'` = every map on the world (the param is omitted). */
    players: 'all' | readonly number[];
    /** Raw pin types (`rawTypesFor`); `undefined` = every type. */
    types: readonly string[] | undefined;
}

/** `GET /plugins/valheim/armory/servers/:serverId/pins?worldUid=&players=&types=`. */
export function valheimServerPinsPath({ serverId, worldUid, players, types }: ServerPinsArgs): string {
    const query = new URLSearchParams({ worldUid });
    if (players !== 'all' && players.length > 0) query.set('players', players.join(','));
    if (types !== undefined && types.length > 0) query.set('types', types.join(','));
    return `/plugins/valheim/armory/servers/${encodePathSegment(String(serverId))}/pins?${query.toString()}`;
}

/** The query key: the armory server key + the request's own inputs. */
export function valheimServerPinsKey(args: ServerPinsArgs) {
    const playersKey = args.players === 'all' ? 'all' : args.players.join(',');
    return [...valheimDeathsKey(args.serverId), 'server-pins', args.worldUid, playersKey, args.types?.join(',') ?? '*'] as const;
}

/** The server pin layer; fetches only while `enabled` (a players scope) and with a real server. */
export function useValheimServerPins(
    args: ServerPinsArgs,
    enabled: boolean,
): UseQueryResult<ValheimServerPinsResponse> {
    return useQuery<ValheimServerPinsResponse>({
        queryKey: valheimServerPinsKey(args),
        queryFn: () => fetchApi(valheimServerPinsPath(args), {}, ValheimServerPinsResponseSchema),
        enabled: enabled && args.serverId > 0,
        retry: false,
    });
}
