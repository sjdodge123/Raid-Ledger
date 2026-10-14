/**
 * ROK-1785: TanStack Query hooks for the guild page and its editor delegation.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { CreateGuildEditorInput, GuildEditor, GuildEditorList, GuildPage } from '@raid-ledger/contract';
import { httpStatusOf } from '../../../lib/api/api-error';
import { createGuildEditor, deleteGuildEditor, fetchGuildEditors, fetchGuildPage } from './guild-api';

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

export function useGuildPage(guildId: number): UseQueryResult<GuildPage, Error> {
    return useQuery({
        queryKey: guildPageKey(guildId),
        queryFn: () => fetchGuildPage(guildId),
        enabled: guildId > 0,
        retry: retryUnlessClientError,
    });
}

export function useGuildEditors(guildId: number, enabled: boolean): UseQueryResult<GuildEditorList, Error> {
    return useQuery({
        queryKey: guildEditorsKey(guildId),
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
