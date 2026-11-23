/**
 * ROK-2212 — the suggested-groups read (`GET /plugins/wow/guilds/:id/suggested-groups`).
 * The payload is audience-dependent (a visitor gets every `userId` null, spec
 * L9), so the key ends in the viewer scope like the other WoW guild queries.
 * The server caches 5 min; the client keeps it as long.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SuggestedGroupsDto } from '@raid-ledger/contract';
import { useAuth, useViewerCacheScope } from '../../../../hooks/use-auth';
import { fetchSuggestedGroups } from '../../api-client';

const STALE_MS = 5 * 60_000;

export type SuggestedGroupsScope = 'top' | 'all';

/** Query key: guild, scope, dungeon filter, viewer scope. */
export function suggestedGroupsKey(guildId: number, scope: SuggestedGroupsScope, instanceId: number | null, viewer: unknown) {
    return ['plugins', 'wow', 'guilds', guildId, 'suggested-groups', scope, instanceId, viewer] as const;
}

/** Suggested groups for one Forever guild hub; idle until signed in (the route is jwt-only). */
export function useSuggestedGroups(
    guildId: number, scope: SuggestedGroupsScope = 'top', instanceId: number | null = null,
): UseQueryResult<SuggestedGroupsDto, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: suggestedGroupsKey(guildId, scope, instanceId, viewer),
        queryFn: () => fetchSuggestedGroups(guildId, scope, instanceId ?? undefined),
        enabled: isAuthenticated && guildId > 0,
        staleTime: STALE_MS,
        retry: false,
    });
}
