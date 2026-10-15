/**
 * ROK-1785: TanStack Query hooks for the guild page and its editor delegation.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { CreateGuildEditorInput, GuildEditor, GuildEditorList, GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { httpStatusOf } from '../../../lib/api/api-error';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { createGuildEditor, deleteGuildEditor, fetchGuildEditors, fetchGuildPage, fetchGuildRaids } from './guild-api';

const MAX_RETRIES = 2;

export function guildPageKey(guildId: number): readonly unknown[] {
    return ['plugins', 'wow', 'guilds', guildId] as const;
}

export function guildEditorsKey(guildId: number): readonly unknown[] {
    return ['plugins', 'wow', 'guilds', guildId, 'editors'] as const;
}

/** A 4xx (403 not a member, 404 no such guild) is an answer, not a blip — don't retry it. */
function retryUnlessClientError(failures: number, error: Error): boolean {
    const status = httpStatusOf(error);
    if (status !== undefined && status >= 400 && status < 500) return false;
    return failures < MAX_RETRIES;
}

/**
 * The page and editor payloads are membership-gated, so the cached entry is
 * keyed by viewer too (ROK-1314 `useViewerCacheScope`); the viewer goes LAST
 * so `guildEditorsKey(guildId)` stays a prefix for invalidation.
 */
export function useGuildPage(guildId: number): UseQueryResult<GuildPage, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildPageKey(guildId), viewer],
        queryFn: () => fetchGuildPage(guildId),
        enabled: guildId > 0,
        retry: retryUnlessClientError,
    });
}

/**
 * ROK-1787: Raids tab + Overview widgets + hero chip. Membership-gated, so viewer-scoped like the page.
 * Signup/roster/event mutations are core and never invalidate this plugin key, so it is always stale:
 * every guild-page mount refetches instead of serving the app-wide 5-minute cache.
 */
export function useGuildRaids(guildId: number): UseQueryResult<GuildRaidsDto, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildPageKey(guildId), 'raids', viewer],
        queryFn: () => fetchGuildRaids(guildId),
        staleTime: 0,
        enabled: guildId > 0,
        retry: retryUnlessClientError,
    });
}

export function useGuildEditors(guildId: number, enabled: boolean): UseQueryResult<GuildEditorList, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildEditorsKey(guildId), viewer],
        queryFn: () => fetchGuildEditors(guildId),
        enabled: enabled && guildId > 0,
        retry: retryUnlessClientError,
    });
}

export function useAddGuildEditor(guildId: number): UseMutationResult<GuildEditor, Error, CreateGuildEditorInput> {
    const queryClient = useQueryClient();
    return useMutation<GuildEditor, Error, CreateGuildEditorInput>({
        mutationFn: (input) => createGuildEditor(guildId, input),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: guildEditorsKey(guildId) }),
    });
}

export function useRemoveGuildEditor(guildId: number): UseMutationResult<void, Error, number> {
    const queryClient = useQueryClient();
    return useMutation<void, Error, number>({
        mutationFn: (editorId) => deleteGuildEditor(guildId, editorId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: guildEditorsKey(guildId) }),
    });
}
