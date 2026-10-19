/**
 * ROK-1831 — the game-server hub's own routes (`/plugins/pelican/hubs/:id`):
 * Join / Leave and the Quick Play list. Every response is parsed by its
 * contract schema; the page itself comes from core `GET /guilds/:id`.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { HubJoinResponseSchema, HubQuickPlayListSchema, type GuildPage, type HubJoinResponse, type HubQuickPlayList } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { guildPageKey } from '../../../components/hub/api/use-guild';

const base = (guildId: number): string => `/plugins/pelican/hubs/${guildId}`;
export const QUICK_PLAY_LIMIT = 20;

/** POST joins, DELETE leaves; both idempotent. */
export function setHubJoined(guildId: number, joined: boolean): Promise<HubJoinResponse> {
    return fetchApi(`${base(guildId)}/join`, { method: joined ? 'POST' : 'DELETE' }, HubJoinResponseSchema);
}

function withJoined(page: GuildPage | undefined, joined: boolean): GuildPage | undefined {
    if (page?.server === undefined) return page;
    return { ...page, server: { ...page.server, viewerJoined: joined } };
}

/** Optimistic Join/Leave: the pill flips at once, rolls back on failure, and the page refetches either way. */
export function useHubJoin(guildId: number): UseMutationResult<HubJoinResponse, Error, boolean, { prev: GuildPage | undefined }> {
    const qc = useQueryClient();
    const viewer = useViewerCacheScope();
    const key = [...guildPageKey(guildId), viewer];
    return useMutation({
        mutationFn: (joined: boolean) => setHubJoined(guildId, joined),
        onMutate: async (joined) => {
            await qc.cancelQueries({ queryKey: key, exact: true });
            const prev = qc.getQueryData<GuildPage>(key);
            qc.setQueryData<GuildPage | undefined>(key, (p) => withJoined(p, joined));
            return { prev };
        },
        onError: (_err, _joined, ctx) => {
            toast.error('Couldn’t update your membership. Try again.');
            if (ctx?.prev) qc.setQueryData(key, ctx.prev);
        },
        onSettled: () => qc.invalidateQueries({ queryKey: key, exact: true }),
    });
}

/** Past and live Quick Play sessions on this server, newest first. */
export function useHubQuickPlay(guildId: number): UseQueryResult<HubQuickPlayList, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: ['plugins', 'pelican', 'hubs', guildId, 'quick-play', viewer],
        queryFn: () => fetchApi(`${base(guildId)}/quick-play?limit=${QUICK_PLAY_LIMIT}`, {}, HubQuickPlayListSchema),
        enabled: guildId > 0,
        retry: false,
    });
}
