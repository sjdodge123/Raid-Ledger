/**
 * ROK-1953 — the Steam cards' read client: `GET /hubs/:guildId/steam-stats`,
 * shape-locked by the contract schema. Schema-bound, so the eager `useVisible`
 * probes import it dynamically (`use-hub-steam-stats.ts`). The route's 404
 * (missing / hidden hub, non-member) becomes `null` — the cards just hide.
 */
import { SteamHubStatsResponseSchema, type SteamHubStatsResponse } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { httpStatusOf } from '../../../lib/api/api-error';
import { encodePathSegment } from '../../../lib/api/path-segment';

/** Fetch one hub's Steam stats; `null` on the members-only route's 404. */
export async function fetchHubSteamStats(guildId: number): Promise<SteamHubStatsResponse | null> {
    try {
        return await fetchApi(`/hubs/${encodePathSegment(String(guildId))}/steam-stats`, {}, SteamHubStatsResponseSchema);
    } catch (err: unknown) {
        if (httpStatusOf(err) === 404) return null;
        throw err;
    }
}
