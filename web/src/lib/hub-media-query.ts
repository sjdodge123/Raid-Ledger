/**
 * ROK-1942 — the Gallery's light query layer: the chip filter, the per-hub,
 * per-filter query key and the Overview strip query. Type-only contract
 * imports and a dynamic import of the fetcher keep it safe for the eagerly
 * loaded probe and header action (app-entry budget); the card body shares the
 * same key, so it reuses the probe's response.
 */
import type { HubMediaKind, HubMediaListResponse } from '@raid-ledger/contract';

/** The Overview card / dialog chip filter. `screenshot` covers `screenshot` + `image` (server-side). */
export type HubMediaFilter = 'all' | 'death' | 'screenshot';

/** Overview strip size: 8 tiles ≥1024px, 6 below (the request always asks for 8). */
export const HUB_GALLERY_STRIP_LIMIT = 8;
export const HUB_GALLERY_STRIP_LIMIT_PHONE = 6;

export const hubMediaKeys = {
    all: (guildId: number) => ['hub-media', guildId] as const,
    strip: (guildId: number, filter: HubMediaFilter) => ['hub-media', guildId, 'strip', filter] as const,
};

export function kindForFilter(filter: HubMediaFilter): HubMediaKind | undefined {
    return filter === 'all' ? undefined : filter;
}

/** The chips a hub's `kinds` justify: Deaths when it has deaths, Screenshots for screenshot OR image. */
export function availableFilters(kinds: readonly HubMediaKind[]): HubMediaFilter[] {
    const out: HubMediaFilter[] = ['all'];
    if (kinds.includes('death')) out.push('death');
    if (kinds.includes('screenshot') || kinds.includes('image')) out.push('screenshot');
    return out;
}

/** `useQuery` options for one hub's Overview strip under one filter; idle until a guild id is known. */
export function hubMediaStripQuery(guildId: number, filter: HubMediaFilter) {
    return {
        queryKey: hubMediaKeys.strip(guildId, filter),
        queryFn: async (): Promise<HubMediaListResponse> =>
            (await import('./hub-media-api')).fetchHubMedia(guildId, { filter, limit: HUB_GALLERY_STRIP_LIMIT }),
        enabled: guildId > 0,
        retry: false,
        staleTime: 30_000,
    };
}
