import type React from 'react';
import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { usePluginStore } from '../../stores/plugin-store';
import { adminFetch } from './admin-fetch';
import type {
    DiscordSetupStatus,
    DiscordBotStatusResponse,
    DiscordBotConfigDto,
    DiscordBotTestResult,
} from '@raid-ledger/contract';
import type {
    DiscordBotPermissionsResult,
    ApiResponse,
} from './admin-settings-types';

const BOT_KEY = ['admin', 'settings', 'discord-bot'] as const;

function useBotStatusQuery(botConfigSavedAt: React.RefObject<number>) {
    return useQuery<DiscordBotStatusResponse>({
        queryKey: [...BOT_KEY],
        queryFn: () => adminFetch('/admin/settings/discord-bot'),
        enabled: !!getAuthToken(),
        staleTime: 15_000,
        refetchInterval: (query) => {
            if (query.state.data?.connecting) return 2000;
            const elapsed = Date.now() - botConfigSavedAt.current;
            if (elapsed < 15_000 && !query.state.data?.connected) return 2000;
            return false;
        },
    });
}

function useBotCoreMutations(botConfigSavedAt: React.MutableRefObject<number>) {
    const queryClient = useQueryClient();

    const updateDiscordBot = useMutation<ApiResponse, Error, DiscordBotConfigDto>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/discord-bot', {
                method: 'PUT', body: JSON.stringify(config),
            }, 'Failed to update Discord bot configuration'),
        onSuccess: () => {
            botConfigSavedAt.current = Date.now();
            queryClient.invalidateQueries({ queryKey: [...BOT_KEY] });
        },
    });

    const testDiscordBot = useMutation<DiscordBotTestResult, Error, { botToken?: string }>({
        mutationFn: (body) =>
            adminFetch('/admin/settings/discord-bot/test', {
                method: 'POST', body: JSON.stringify(body),
            }, 'Failed to test Discord bot connection'),
    });

    const clearDiscordBot = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/discord-bot/clear', { method: 'POST' }, 'Failed to clear Discord bot configuration'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...BOT_KEY] }),
    });

    const checkDiscordBotPermissions = useMutation<DiscordBotPermissionsResult, Error>({
        mutationFn: () => adminFetch('/admin/settings/discord-bot/permissions'),
    });

    return { updateDiscordBot, testDiscordBot, clearDiscordBot, checkDiscordBotPermissions };
}

function useBotChannelQueries(botConnected: boolean) {
    const queryClient = useQueryClient();

    const discordChannels = useQuery<{ id: string; name: string }[]>({
        queryKey: [...BOT_KEY, 'channels'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/channels'),
        enabled: !!getAuthToken() && botConnected,
        staleTime: 30_000,
    });

    const discordDefaultChannel = useQuery<{ channelId: string | null }>({
        queryKey: [...BOT_KEY, 'channel'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/channel'),
        enabled: !!getAuthToken() && botConnected,
        staleTime: 30_000,
    });

    const setDiscordChannel = useMutation<ApiResponse, Error, string>({
        mutationFn: (channelId) =>
            adminFetch('/admin/settings/discord-bot/channel', {
                method: 'PUT', body: JSON.stringify({ channelId }),
            }, 'Failed to set default channel'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...BOT_KEY, 'channel'] }),
    });

    return { discordChannels, discordDefaultChannel, setDiscordChannel };
}

function useBotSetupActions(botConfigSavedAt: React.MutableRefObject<number>) {
    const queryClient = useQueryClient();
    const isDiscordActive = usePluginStore((s) => s.isPluginActive('discord'));

    const setupStatus = useQuery<DiscordSetupStatus>({
        queryKey: [...BOT_KEY, 'setup-status'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/setup-status'),
        enabled: !!getAuthToken() && isDiscordActive,
        staleTime: 30_000,
    });

    const reconnectBot = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/discord-bot/reconnect', { method: 'POST' }, 'Failed to reconnect'),
        onSuccess: () => {
            botConfigSavedAt.current = Date.now();
            queryClient.invalidateQueries({ queryKey: [...BOT_KEY] });
        },
    });

    const sendTestMessage = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/discord-bot/test-message', { method: 'POST' }, 'Failed to send test message'),
    });

    return { setupStatus, reconnectBot, sendTestMessage };
}

function useBotVoiceChannels(botConnected: boolean) {
    const queryClient = useQueryClient();

    const discordVoiceChannels = useQuery<{ id: string; name: string }[]>({
        queryKey: [...BOT_KEY, 'voice-channels', { botConnected }],
        queryFn: () => adminFetch('/admin/settings/discord-bot/voice-channels'),
        enabled: !!getAuthToken() && botConnected,
        staleTime: 30_000,
    });

    const discordDefaultVoiceChannel = useQuery<{ channelId: string | null }>({
        queryKey: [...BOT_KEY, 'voice-channel'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/voice-channel'),
        enabled: !!getAuthToken() && botConnected,
        staleTime: 30_000,
    });

    const setDiscordVoiceChannel = useMutation<ApiResponse, Error, string>({
        mutationFn: (channelId) =>
            adminFetch('/admin/settings/discord-bot/voice-channel', {
                method: 'PUT', body: JSON.stringify({ channelId }),
            }, 'Failed to set default voice channel'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...BOT_KEY, 'voice-channel'] }),
    });

    return { discordVoiceChannels, discordDefaultVoiceChannel, setDiscordVoiceChannel };
}

function useBotAdHocEvents(botConnected: boolean) {
    const queryClient = useQueryClient();

    const adHocEventsStatus = useQuery<{ enabled: boolean }>({
        queryKey: [...BOT_KEY, 'ad-hoc'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/ad-hoc'),
        enabled: !!getAuthToken() && botConnected,
    });

    const updateAdHocEvents = useMutation<ApiResponse, Error, { enabled: boolean }>({
        mutationFn: (data) =>
            adminFetch('/admin/settings/discord-bot/ad-hoc', {
                method: 'PUT', body: JSON.stringify(data),
            }, 'Failed to update ad-hoc events setting'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...BOT_KEY, 'ad-hoc'] }),
    });

    return { adHocEventsStatus, updateAdHocEvents };
}

/** Discord bot settings queries and mutations */
export function useDiscordBotSettings() {
    const botConfigSavedAt = useRef<number>(0);
    const discordBotStatus = useBotStatusQuery(botConfigSavedAt);
    const botConnected = !!discordBotStatus.data?.connected;

    return {
        discordBotStatus,
        ...useBotCoreMutations(botConfigSavedAt),
        ...useBotChannelQueries(botConnected),
        ...useBotSetupActions(botConfigSavedAt),
        ...useBotVoiceChannels(botConnected),
        ...useBotAdHocEvents(botConnected),
    };
}
