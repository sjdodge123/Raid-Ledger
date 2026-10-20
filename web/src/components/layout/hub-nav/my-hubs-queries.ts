/**
 * ROK-1785/ROK-1870 (D9): the viewer's hubs for the nav entry points. Core
 * `GET /guilds/mine` is kind-agnostic (every live hub adapter's
 * `memberGroupIds`), so WoW guilds, server hubs and community hubs all arrive
 * here with no plugin involved. Signed-out viewers never fetch. The key ends
 * in the viewer scope (ROK-1314) so a sign-out + sign-in on one browser never
 * shows the previous viewer's hubs. The key is unchanged from its WoW-plugin
 * days so existing invalidations keep working.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { MyGuildsSchema, type MyGuild } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';

const STALE_MS = 60_000;

/** The `/hubs` directory route the permanent "Hubs" nav item points at. */
export const HUBS_PATH = '/hubs';

/** "1 member" / "12 members". */
export function memberCountLabel(count: number): string {
    return `${count} ${count === 1 ? 'member' : 'members'}`;
}

/** The hub page of one hub. */
export function guildHref(guildId: number): string {
    return `/guilds/${guildId}`;
}

/**
 * The viewer's hubs WITH the query state, for callers that must tell an empty
 * answer apart from an unsettled or failed one (`useMyGuilds` cannot).
 */
export function useMyGuildsQuery(): UseQueryResult<{ guilds: MyGuild[] }, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: ['plugins', 'wow', 'guilds', 'mine', viewer],
        queryFn: () => fetchApi('/guilds/mine', {}, MyGuildsSchema),
        enabled: isAuthenticated,
        staleTime: STALE_MS,
        retry: false,
    });
}

/** The viewer's hubs; `[]` while loading, on error, or signed out. */
export function useMyGuilds(): MyGuild[] {
    return useMyGuildsQuery().data?.guilds ?? [];
}
