/**
 * ROK-1786: TanStack Query hooks for the core guild page content (profile).
 * Keys extend `guildPageKey(guildId)` and end with the viewer scope (ROK-1314),
 * so `guildProfileKey(id)` stays an invalidation prefix. The WoW plugin's
 * addon hooks live in `plugins/wow/hub/use-guild-addons.ts` (ROK-2361).
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { GuildProfile, UpdateGuildProfileInput } from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { fetchGuildProfile, patchGuildProfile } from './guild-content-api';
import { guildPageKey } from './use-guild';

export function guildProfileKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'profile'] as const;
}

export function useGuildProfile(guildId: number, enabled = true): UseQueryResult<GuildProfile, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildProfileKey(guildId), viewer],
        queryFn: () => fetchGuildProfile(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

/**
 * Prefix of the Players page's "my guilds" query (`slots/guild-queries.ts`),
 * without the viewer scope so every scope refreshes.
 */
export const MY_GUILDS_KEY_PREFIX = ['plugins', 'wow', 'guilds', 'mine'] as const;

/** Saving also refreshes `mine`, whose `gmPostHeadline` the Players page shows. */
export function useUpdateGuildProfile(guildId: number): UseMutationResult<GuildProfile, Error, UpdateGuildProfileInput> {
    const queryClient = useQueryClient();
    return useMutation<GuildProfile, Error, UpdateGuildProfileInput>({
        mutationFn: (input) => patchGuildProfile(guildId, input),
        onSuccess: () => Promise.all([
            queryClient.invalidateQueries({ queryKey: guildProfileKey(guildId) }),
            queryClient.invalidateQueries({ queryKey: MY_GUILDS_KEY_PREFIX }),
        ]),
    });
}
