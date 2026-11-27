/**
 * ROK-1786: TanStack Query hooks for the WoW plugin's recommended addons.
 * Moved out of core's `components/hub/api/use-guild-content.ts` (ROK-2361)
 * with the key unchanged: `guildAddonsKey(id)` extends core's
 * `guildPageKey(guildId)` and the query ends with the viewer scope (ROK-1314),
 * so it stays an invalidation prefix and the cache behaves as before.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { GuildAddon, GuildAddonList, UpdateGuildAddonInput } from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { guildPageKey } from '../../../components/hub/api/use-guild';
import {
    createGuildAddon, deleteGuildAddon, fetchGuildAddons, reorderGuildAddons, updateGuildAddon, type CreateAddonBody,
} from './guild-addons-api';

export function guildAddonsKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'addons'] as const;
}

export function useGuildAddons(guildId: number, enabled = true): UseQueryResult<GuildAddonList, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildAddonsKey(guildId), viewer],
        queryFn: () => fetchGuildAddons(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

/** Add / edit / remove / reorder; each refreshes the addons list (and `mine`, untouched). */
export function useGuildAddonMutations(guildId: number) {
    const queryClient = useQueryClient();
    const onSuccess = () => queryClient.invalidateQueries({ queryKey: guildAddonsKey(guildId) });
    const add = useMutation<GuildAddon, Error, CreateAddonBody>({ mutationFn: (b) => createGuildAddon(guildId, b), onSuccess });
    const update = useMutation<GuildAddon, Error, { id: number; input: UpdateGuildAddonInput }>({
        mutationFn: ({ id, input }) => updateGuildAddon(guildId, id, input), onSuccess,
    });
    const remove = useMutation<void, Error, number>({ mutationFn: (id) => deleteGuildAddon(guildId, id), onSuccess });
    const reorder = useMutation<GuildAddonList, Error, number[]>({ mutationFn: (ids) => reorderGuildAddons(guildId, ids), onSuccess });
    return { add, update, remove, reorder };
}
