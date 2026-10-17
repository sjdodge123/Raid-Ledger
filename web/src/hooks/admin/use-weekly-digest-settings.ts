/**
 * ROK-1435 (L5): weekly Discord digest settings — toggle, dedicated channel,
 * and the day + hour it posts on (community timezone). Mirrors
 * `use-lfg-board-settings.ts`; the guild's text channels share the query key
 * `use-discord-bot-settings.ts` uses, so the list is fetched once per page.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type {
    WeeklyDigestSettings,
    WeeklyDigestSettingsResponse,
} from '@raid-ledger/contract';

const BOT_KEY = ['admin', 'settings', 'discord-bot'] as const;
const URL = '/admin/settings/discord-bot/weekly-digest';

/** Query key for the weekly digest settings. */
export const WEEKLY_DIGEST_KEY = [...BOT_KEY, 'weekly-digest'] as const;

export interface DiscordChannelOption { id: string; name: string }

export interface WeeklyDigestSettingsHook {
    status: UseQueryResult<WeeklyDigestSettingsResponse>;
    channels: UseQueryResult<DiscordChannelOption[]>;
    update: UseMutationResult<WeeklyDigestSettingsResponse, Error, WeeklyDigestSettings>;
}

/** Reads and replaces the weekly digest settings; lists channels for the picker. */
export function useWeeklyDigestSettings(): WeeklyDigestSettingsHook {
    const queryClient = useQueryClient();
    const enabled = !!getAuthToken();

    const status = useQuery<WeeklyDigestSettingsResponse>({
        queryKey: [...WEEKLY_DIGEST_KEY],
        queryFn: () => adminFetch(URL),
        enabled,
    });

    const channels = useQuery<DiscordChannelOption[]>({
        queryKey: [...BOT_KEY, 'channels'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/channels'),
        enabled,
        staleTime: 30_000,
    });

    const update = useMutation<WeeklyDigestSettingsResponse, Error, WeeklyDigestSettings>({
        mutationFn: (data) =>
            adminFetch(URL, { method: 'PUT', body: JSON.stringify(data) },
                'Failed to update weekly digest settings'),
        onSuccess: (saved) => queryClient.setQueryData([...WEEKLY_DIGEST_KEY], saved),
    });

    return { status, channels, update };
}
