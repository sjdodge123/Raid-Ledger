/**
 * ROK-2152: the nav's "Popular hubs" — up to 5 hubs the viewer may see but is
 * not in, most members first. It reuses the `/hubs` directory read (D1), so
 * nothing appears that the directory would not already list to this viewer.
 * It over-fetches 10 and drops banned, staff-hidden and already-mine rows on
 * the client (D2). The key sits under `['hubs-directory']` so every existing
 * Join/Leave invalidation refetches it (D3), and ends in the viewer scope
 * (ROK-1314).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { HubDirectoryPageSchema, type HubDirectoryEntry, type HubDirectoryPage, type MyGuild } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';

/** How many popular hubs the menu / sheet lists at most. */
export const POPULAR_HUBS_SHOWN = 5;
/** How many the nav asks for, leaving room for the rows the client drops. */
export const POPULAR_HUBS_FETCH = 10;

const STALE_MS = 60_000;
const POPULAR_PATH = `/hubs?membership=not-joined&sort=members&limit=${POPULAR_HUBS_FETCH}`;

/** The viewer-scoped cache key, under the `['hubs-directory']` invalidation prefix. */
export function popularHubsKey(viewer: number | 'anon'): readonly ['hubs-directory', 'nav-popular', number | 'anon'] {
    return ['hubs-directory', 'nav-popular', viewer];
}

/** The raw directory page; signed-out viewers never fetch. */
export function usePopularHubsQuery(): UseQueryResult<HubDirectoryPage, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: popularHubsKey(viewer),
        queryFn: () => fetchApi(POPULAR_PATH, {}, HubDirectoryPageSchema),
        enabled: isAuthenticated,
        staleTime: STALE_MS,
        retry: false,
    });
}

/** Drops banned, staff-hidden and already-mine rows; keeps the server's order; at most 5. */
export function selectPopularHubs(items: HubDirectoryEntry[], mineIds: ReadonlySet<number>): HubDirectoryEntry[] {
    return items
        .filter((h) => h.viewer !== 'banned' && h.hidden !== true && !mineIds.has(h.id))
        .slice(0, POPULAR_HUBS_SHOWN);
}

/** The popular hubs to list (`[]` while loading, on error, or signed out) and whether the read has settled. */
export function usePopularHubs(mine: MyGuild[]): { hubs: HubDirectoryEntry[]; settled: boolean } {
    const query = usePopularHubsQuery();
    const hubs = selectPopularHubs(query.data?.items ?? [], new Set(mine.map((g) => g.id)));
    return { hubs, settled: query.isSuccess || query.isError };
}
