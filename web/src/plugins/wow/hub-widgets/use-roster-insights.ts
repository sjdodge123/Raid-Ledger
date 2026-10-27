/**
 * ROK-1905 — the shared data hook for the WoW: Forever guild hub widgets
 * (class / level / role / professions). One query per guild + mains filter +
 * viewer scope: the payload is audience-dependent (professions are omitted for
 * visitors), so the key ends in the viewer scope (ROK-1314) like other WoW
 * guild queries. The server caches 5 min; the client keeps it 60 s.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { WowRosterInsightsSchema, type WowRosterInsightsDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';

const STALE_MS = 60_000;

export function rosterInsightsKey(guildId: number, mainsOnly: boolean, viewer: unknown): unknown[] {
    return ['plugins', 'wow', 'guilds', guildId, 'roster-insights', mainsOnly, viewer];
}

/** Roster insights for one guild hub; `mainsOnly` filters linked members to their mains. */
export function useRosterInsights(guildId: number, mainsOnly = false): UseQueryResult<WowRosterInsightsDto, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    const qs = mainsOnly ? '?mainsOnly=true' : '';
    return useQuery({
        queryKey: rosterInsightsKey(guildId, mainsOnly, viewer),
        queryFn: () => fetchApi(`/plugins/wow/guilds/${guildId}/roster-insights${qs}`, {}, WowRosterInsightsSchema),
        enabled: isAuthenticated && guildId > 0,
        staleTime: STALE_MS,
        retry: false,
    });
}
