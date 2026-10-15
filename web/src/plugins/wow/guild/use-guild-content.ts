/**
 * ROK-1786: TanStack Query hooks for the guild page content (profile + addons).
 * Keys extend `guildPageKey(guildId)` and end with the viewer scope (ROK-1314),
 * so `guildProfileKey(id)` / `guildAddonsKey(id)` stay invalidation prefixes.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { GuildAddon, GuildAddonList, GuildProfile, UpdateGuildAddonInput, UpdateGuildProfileInput } from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import {
    createGuildAddon, deleteGuildAddon, fetchGuildAddons, fetchGuildProfile, patchGuildProfile, reorderGuildAddons,
    updateGuildAddon, type CreateAddonBody,
} from './guild-content-api';
import { guildPageKey } from './use-guild';

export function guildProfileKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'profile'] as const;
}

export function guildAddonsKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'addons'] as const;
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

export function useGuildAddons(guildId: number, enabled = true): UseQueryResult<GuildAddonList, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildAddonsKey(guildId), viewer],
        queryFn: () => fetchGuildAddons(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

export function useUpdateGuildProfile(guildId: number): UseMutationResult<GuildProfile, Error, UpdateGuildProfileInput> {
    const queryClient = useQueryClient();
    return useMutation<GuildProfile, Error, UpdateGuildProfileInput>({
        mutationFn: (input) => patchGuildProfile(guildId, input),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: guildProfileKey(guildId) }),
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
