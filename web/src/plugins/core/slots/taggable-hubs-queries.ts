/**
 * ROK-2071 — the hubs of one game the viewer may tag an event to (Core
 * `GET /guilds/taggable?gameId=`): every live hub kind — WoW guild, game
 * server, community. Staff get every hub of the game, others only the hubs
 * they edit; the server re-checks the same rights on `PATCH /events/:id`.
 * The key ends in the viewer scope (ROK-1314) so a sign-out + sign-in on one
 * browser never shows the previous viewer's list.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { TaggableHubsSchema, type TaggableHubs } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';

const STALE_MS = 60_000;

/** `GET /guilds/taggable?gameId=N`. */
export function fetchTaggableHubs(gameId: number): Promise<TaggableHubs> {
    return fetchApi(`/guilds/taggable?gameId=${gameId}`, {}, TaggableHubsSchema);
}

/** The taggable hubs of `gameId`; disabled until a game is picked and the viewer is signed in. */
export function useTaggableHubsQuery(gameId: number | undefined): UseQueryResult<TaggableHubs, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: ['guilds', 'taggable', gameId, viewer],
        queryFn: () => fetchTaggableHubs(gameId ?? 0),
        enabled: isAuthenticated && !!gameId,
        staleTime: STALE_MS,
        retry: false,
    });
}
