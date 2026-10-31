/**
 * ROK-1703 D-8 — waiting for the bot to join a server on 4d, and the
 * automatic permission check that follows.
 *
 * The bot status shares the wizard's `['admin','settings','discord-bot']` key.
 * While `waiting` is true and the bot has not joined, this observer polls
 * every 3 s (TanStack `refetchInterval`); polling ends on join, and on unmount
 * because an interval belongs to its observer. Once joined, the permission
 * check runs ONCE: it is cached for the session (`staleTime: Infinity`), so
 * 4e reads the same result without asking Discord again.
 */
import { useQuery } from '@tanstack/react-query';
import type { DiscordBotStatusResponse } from '@raid-ledger/contract';
import { adminFetch } from '../../../../hooks/admin/admin-fetch';
import type { DiscordBotPermissionsResult } from '../../../../hooks/admin/admin-settings-types';
import { getAuthToken } from '../../../../hooks/use-auth';

export const BOT_JOIN_POLL_MS = 3000;
const BOT_KEY = ['admin', 'settings', 'discord-bot'] as const;

/** Joined = connected AND in a server (the same test D-2 uses for 4e). */
export function isBotJoined(bot: DiscordBotStatusResponse | undefined): boolean {
    return !!bot?.connected && !!bot.guildName;
}

/** The bot status; polls every 3 s while `waiting` and not yet joined. */
export function useBotStatus(waiting = false) {
    return useQuery<DiscordBotStatusResponse>({
        queryKey: [...BOT_KEY],
        queryFn: () => adminFetch('/admin/settings/discord-bot'),
        enabled: !!getAuthToken(),
        refetchInterval: (query) => (waiting && !isBotJoined(query.state.data) ? BOT_JOIN_POLL_MS : false),
    });
}

/** `GET …/permissions`, fetched once per session after the bot joins. */
export function useBotPermissions(joined: boolean) {
    return useQuery<DiscordBotPermissionsResult>({
        queryKey: [...BOT_KEY, 'permissions'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/permissions'),
        enabled: !!getAuthToken() && joined,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false,
    });
}

export function useWaitForBotJoin(waiting: boolean) {
    const status = useBotStatus(waiting);
    const joined = isBotJoined(status.data);
    const permissions = useBotPermissions(joined);
    return { bot: status.data, joined, permissions: permissions.data };
}
