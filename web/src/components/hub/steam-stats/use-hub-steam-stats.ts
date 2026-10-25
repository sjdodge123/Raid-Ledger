/**
 * ROK-1953 §5.1 — the Steam cards' light query layer, shared by the eager
 * `useVisible` probes and both card bodies (one request per hub). Type-only
 * contract import + a dynamic import of the fetcher keep it out of app-entry.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SteamHubStatsResponse } from '@raid-ledger/contract';

/** Steam stats refresh nightly; 10 minutes is plenty. */
export const HUB_STEAM_STATS_STALE_MS = 10 * 60_000;

export const hubSteamStatsKey = (guildId: number) => ['hub-steam-stats', guildId] as const;

/** `useQuery` options for one hub's Steam stats; idle until a guild id is known. */
export function hubSteamStatsQuery(guildId: number) {
    return {
        queryKey: hubSteamStatsKey(guildId),
        queryFn: async (): Promise<SteamHubStatsResponse | null> =>
            (await import('./steam-stats-api')).fetchHubSteamStats(guildId),
        enabled: guildId > 0,
        retry: false,
        staleTime: HUB_STEAM_STATS_STALE_MS,
    };
}

/** One hub's Steam stats: `null` = the route 404'd, `{ available: false }` = game not enabled. */
export function useHubSteamStats(guildId: number): UseQueryResult<SteamHubStatsResponse | null> {
    return useQuery(hubSteamStatsQuery(guildId));
}
