/**
 * ROK-1919 — the WoW: Forever "Recent dings" feed for one guild hub:
 * `GET /plugins/wow/guilds/:id/recent-dings` (last 30 days, newest first,
 * max 20). The payload is the same for every viewer, but the key still ends in
 * the viewer scope (ROK-1314) like the other WoW guild queries
 * (`use-roster-insights.ts`), so a sign-out never serves a cached feed.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { WowRecentDingsSchema, type WowRecentDingsDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';

const STALE_MS = 60_000;

export function recentDingsKey(guildId: number, viewer: unknown): unknown[] {
    return ['plugins', 'wow', 'guilds', guildId, 'recent-dings', viewer];
}

/** The guild's recent level-ups. */
export function useRecentDings(guildId: number): UseQueryResult<WowRecentDingsDto, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: recentDingsKey(guildId, viewer),
        queryFn: () => fetchApi(`/plugins/wow/guilds/${guildId}/recent-dings`, {}, WowRecentDingsSchema),
        enabled: isAuthenticated && guildId > 0,
        staleTime: STALE_MS,
        retry: false,
    });
}
