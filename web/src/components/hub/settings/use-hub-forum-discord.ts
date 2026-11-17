/**
 * ROK-2208 S3 — TanStack Query hooks for the hub's Discord forum binding.
 * Keys extend `guildPageKey(guildId)` and end with the viewer scope
 * (ROK-1314). Bind / unlink refresh the status, the channel list and the
 * preflight (share counts and free tag slots change with every binding);
 * unlink also drops the cached picker data so a remounted form never
 * preselects a forum the unlink just deleted.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { guildPageKey } from '../api/use-guild';
import {
    deleteHubForumDiscord, fetchHubForumDiscord, fetchHubForumDiscordChannels, fetchHubForumDiscordPreflight,
    putHubForumDiscord, type HubForumDiscordChannelOptions, type HubForumDiscordPreflight,
    type HubForumDiscordStatus, type PutHubForumDiscordInput,
} from './hub-forum-discord-api';

/** Prefix shared by the status and channel-list queries. */
export function hubForumDiscordKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'forum-discord'] as const;
}

/** The hub's binding status (Officer+). */
export function useHubForumDiscord(guildId: number, enabled = true): UseQueryResult<HubForumDiscordStatus, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...hubForumDiscordKey(guildId), 'status', viewer],
        queryFn: () => fetchHubForumDiscord(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

/** The forum channels the picker offers; only fetched while the form shows. */
export function useHubForumDiscordChannels(guildId: number, enabled: boolean): UseQueryResult<HubForumDiscordChannelOptions, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...hubForumDiscordKey(guildId), 'channels', viewer],
        queryFn: () => fetchHubForumDiscordChannels(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

/** Bot online, missing permissions and the shared forum; read before the picker. */
export function useHubForumDiscordPreflight(guildId: number, enabled: boolean): UseQueryResult<HubForumDiscordPreflight, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...hubForumDiscordKey(guildId), 'preflight', viewer],
        queryFn: () => fetchHubForumDiscordPreflight(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

function useRefresh(guildId: number, dropPicker = false): () => Promise<void> {
    const queryClient = useQueryClient();
    return () => {
        if (dropPicker) {
            for (const part of ['channels', 'preflight']) queryClient.removeQueries({ queryKey: [...hubForumDiscordKey(guildId), part] });
        }
        return queryClient.invalidateQueries({ queryKey: hubForumDiscordKey(guildId) });
    };
}

/** `PUT` — turn sync on (the input carries the acknowledgement). */
export function useBindHubForumDiscord(guildId: number): UseMutationResult<HubForumDiscordStatus, Error, PutHubForumDiscordInput> {
    const onSuccess = useRefresh(guildId);
    return useMutation<HubForumDiscordStatus, Error, PutHubForumDiscordInput>({
        mutationFn: (input) => putHubForumDiscord(guildId, input),
        onSuccess,
    });
}

/** `DELETE` — unlink; the variable asks to delete a bot-made, unshared forum. */
export function useUnlinkHubForumDiscord(guildId: number): UseMutationResult<void, Error, boolean> {
    const onSuccess = useRefresh(guildId, true);
    return useMutation<void, Error, boolean>({
        mutationFn: (deleteForum) => deleteHubForumDiscord(guildId, deleteForum),
        onSuccess,
    });
}
