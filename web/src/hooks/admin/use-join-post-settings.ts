/**
 * ROK-1740: the pinned "Join Raid Ledger" Discord post — where it lives, and
 * post / re-post / remove. The guild's text channels share the query key the
 * other bot settings hooks use, so the list is fetched once per page.
 *
 * A 422 (bot lacks permissions in the channel) carries `{ message, missing }`;
 * `joinPostMissing` reads that list off the thrown `AdminFetchError`.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { JOIN_POST_PERMISSION_NAMES } from '@raid-ledger/contract';
import type {
    DiscordJoinPostResult,
    DiscordJoinPostStatus,
    JoinPostPermissionName,
} from '@raid-ledger/contract';
import { getAuthToken } from '../use-auth';
import { adminFetch, AdminFetchError } from './admin-fetch';
import type { DiscordChannelOption } from './use-weekly-digest-settings';

const BOT_KEY = ['admin', 'settings', 'discord-bot'] as const;
const URL = '/admin/settings/discord-bot/join-post';

/** Query key for the join post's stored location. */
export const JOIN_POST_KEY = [...BOT_KEY, 'join-post'] as const;

export interface JoinPostSettingsHook {
    status: UseQueryResult<DiscordJoinPostStatus>;
    channels: UseQueryResult<DiscordChannelOption[]>;
    publish: UseMutationResult<DiscordJoinPostResult, Error, string>;
    remove: UseMutationResult<{ removed: boolean }, Error, void>;
}

/** The missing-permission names of a 422 publish error, else null. */
export function joinPostMissing(error: unknown): JoinPostPermissionName[] | null {
    if (!(error instanceof AdminFetchError) || error.status !== 422) return null;
    const { body } = error;
    if (typeof body !== 'object' || body === null || !('missing' in body)) return null;
    const { missing } = body;
    return Array.isArray(missing) ? missing.filter(isPermissionName) : null;
}

function isPermissionName(value: unknown): value is JoinPostPermissionName {
    return JOIN_POST_PERMISSION_NAMES.some((name) => name === value);
}

/** Reads the join post's location; posts, re-posts and removes it. */
export function useJoinPostSettings(): JoinPostSettingsHook {
    const queryClient = useQueryClient();
    const enabled = !!getAuthToken();
    const setStatus = (next: DiscordJoinPostStatus) =>
        queryClient.setQueryData<DiscordJoinPostStatus>([...JOIN_POST_KEY], next);

    const status = useQuery<DiscordJoinPostStatus>({
        queryKey: [...JOIN_POST_KEY], queryFn: () => adminFetch(URL), enabled,
    });
    const channels = useQuery<DiscordChannelOption[]>({
        queryKey: [...BOT_KEY, 'channels'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/channels'),
        enabled,
        staleTime: 30_000,
    });
    const publish = useMutation<DiscordJoinPostResult, Error, string>({
        mutationFn: (channelId) => adminFetch(URL,
            { method: 'POST', body: JSON.stringify({ channelId }) }, 'Failed to post the join message'),
        onSuccess: (r) => setStatus({ channelId: r.channelId, messageId: r.messageId }),
    });
    const remove = useMutation<{ removed: boolean }, Error, void>({
        mutationFn: () => adminFetch(URL, { method: 'DELETE' }, 'Failed to remove the join message'),
        onSuccess: () => setStatus({ channelId: null, messageId: null }),
    });
    return { status, channels, publish, remove };
}
