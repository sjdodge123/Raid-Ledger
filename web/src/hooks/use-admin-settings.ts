import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

interface OAuthStatusResponse {
    configured: boolean;
    callbackUrl: string | null;
}

interface OAuthConfigDto {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
}

interface OAuthTestResponse {
    success: boolean;
    message: string;
}

interface IgdbHealthStatus {
    tokenStatus: 'valid' | 'expired' | 'not_fetched';
    tokenExpiresAt: string | null;
    lastApiCallAt: string | null;
    lastApiCallSuccess: boolean | null;
}

interface IgdbSyncStatus {
    lastSyncAt: string | null;
    gameCount: number;
    syncInProgress: boolean;
}

interface IgdbStatusResponse {
    configured: boolean;
    health?: IgdbHealthStatus;
}

interface IgdbConfigDto {
    clientId: string;
    clientSecret: string;
}

interface BlizzardStatusResponse {
    configured: boolean;
}

interface BlizzardConfigDto {
    clientId: string;
    clientSecret: string;
}

interface DiscordBotStatusResponse {
    configured: boolean;
    connected: boolean;
    enabled?: boolean;
    connecting?: boolean;
    guildName?: string;
    memberCount?: number;
    setupCompleted?: boolean;
}

interface DiscordBotConfigDto {
    botToken: string;
    enabled: boolean;
}

interface DiscordBotTestResult {
    success: boolean;
    guildName?: string;
    message: string;
}

interface DiscordBotPermissionsResult {
    allGranted: boolean;
    permissions: { name: string; granted: boolean }[];
}

interface ApiResponse {
    success: boolean;
    message: string;
}

export interface DemoDataCounts {
    users: number;
    events: number;
    characters: number;
    signups: number;
    availability: number;
    gameTimeSlots: number;
    notifications: number;
}

export interface DemoDataStatus extends DemoDataCounts {
    demoMode: boolean;
}

export interface DemoDataResult {
    success: boolean;
    message: string;
    counts: DemoDataCounts;
}

/**
 * Hook for admin settings API operations.
 */
export function useAdminSettings() {
    const queryClient = useQueryClient();

    // Helper to get fresh headers with current token
    const getHeaders = () => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    });

    // Get OAuth status
    const oauthStatus = useQuery<OAuthStatusResponse>({
        queryKey: ['admin', 'settings', 'oauth'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/oauth`, {
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error('Failed to fetch OAuth status');
            }

            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    // Update OAuth config
    const updateOAuth = useMutation<ApiResponse, Error, OAuthConfigDto>({
        mutationFn: async (config) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/oauth`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify(config),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to update OAuth configuration' }));
                throw new Error(error.message || 'Failed to update OAuth configuration');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'oauth'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
        },
    });

    // Test OAuth credentials
    const testOAuth = useMutation<OAuthTestResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/oauth/test`, {
                method: 'POST',
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error('Failed to test OAuth configuration');
            }

            return response.json();
        },
    });

    // Clear OAuth config
    const clearOAuth = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/oauth/clear`, {
                method: 'POST',
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error('Failed to clear OAuth configuration');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'oauth'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
        },
    });

    // ============================================================
    // IGDB Configuration (ROK-229)
    // ============================================================

    // Get IGDB status
    const igdbStatus = useQuery<IgdbStatusResponse>({
        queryKey: ['admin', 'settings', 'igdb'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/igdb`, {
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error('Failed to fetch IGDB status');
            }

            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    // Update IGDB config
    const updateIgdb = useMutation<ApiResponse, Error, IgdbConfigDto>({
        mutationFn: async (config) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/igdb`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify(config),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to update IGDB configuration' }));
                throw new Error(error.message || 'Failed to update IGDB configuration');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb'] });
        },
    });

    // Test IGDB credentials
    const testIgdb = useMutation<OAuthTestResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/igdb/test`, {
                method: 'POST',
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error('Failed to test IGDB configuration');
            }

            return response.json();
        },
    });

    // Clear IGDB config
    const clearIgdb = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/igdb/clear`, {
                method: 'POST',
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error('Failed to clear IGDB configuration');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb'] });
        },
    });

    // ============================================================
    // Blizzard API Configuration (ROK-234)
    // ============================================================

    const blizzardStatus = useQuery<BlizzardStatusResponse>({
        queryKey: ['admin', 'settings', 'blizzard'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/blizzard`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch Blizzard status');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateBlizzard = useMutation<ApiResponse, Error, BlizzardConfigDto>({
        mutationFn: async (config) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/blizzard`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify(config),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to update Blizzard configuration' }));
                throw new Error(error.message || 'Failed to update Blizzard configuration');
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'blizzard'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
        },
    });

    const testBlizzard = useMutation<OAuthTestResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/blizzard/test`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to test Blizzard configuration');
            return response.json();
        },
    });

    const clearBlizzard = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/blizzard/clear`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to clear Blizzard configuration');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'blizzard'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
        },
    });

    // ============================================================
    // IGDB Sync Status (ROK-173)
    // ============================================================

    // Get IGDB adult content filter status
    const igdbAdultFilter = useQuery<{ enabled: boolean }>({
        queryKey: ['admin', 'settings', 'igdb', 'adult-filter'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/igdb/adult-filter`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch adult filter status');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    // Toggle IGDB adult content filter
    const updateAdultFilter = useMutation<ApiResponse & { hiddenCount?: number }, Error, boolean>({
        mutationFn: async (enabled) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/igdb/adult-filter`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ enabled }),
            });
            if (!response.ok) throw new Error('Failed to update adult filter');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb', 'adult-filter'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'games'] });
        },
    });

    const igdbSyncStatus = useQuery<IgdbSyncStatus>({
        queryKey: ['admin', 'settings', 'igdb', 'sync-status'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/igdb/sync-status`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch sync status');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 10_000,
    });

    const syncIgdb = useMutation<ApiResponse & { refreshed: number; discovered: number }, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/igdb/sync`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to trigger sync');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb', 'sync-status'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb'] });
        },
    });

    // ============================================================
    // Demo Data (ROK-193)
    // ============================================================

    const demoDataStatus = useQuery<DemoDataStatus>({
        queryKey: ['admin', 'settings', 'demo', 'status'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/demo/status`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch demo data status');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 10_000,
    });

    const installDemoData = useMutation<DemoDataResult, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/demo/install`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to install demo data');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'demo', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['events'] });
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
    });

    const clearDemoData = useMutation<DemoDataResult, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/demo/clear`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to clear demo data');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'demo', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['events'] });
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
    });

    // ============================================================
    // Default Timezone (ROK-431)
    // ============================================================

    const defaultTimezone = useQuery<{ timezone: string | null }>({
        queryKey: ['admin', 'settings', 'timezone'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/timezone`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch default timezone');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateTimezone = useMutation<ApiResponse, Error, string>({
        mutationFn: async (timezone) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/timezone`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ timezone }),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to update timezone' }));
                throw new Error(error.message || 'Failed to update timezone');
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'timezone'] });
        },
    });

    // ============================================================
    // Discord Bot (ROK-117)
    // ============================================================

    // Track when a config save occurs so we can poll until the bot connects
    const botConfigSavedAt = useRef<number>(0);

    const discordBotStatus = useQuery<DiscordBotStatusResponse>({
        queryKey: ['admin', 'settings', 'discord-bot'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch Discord bot status');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 15_000,
        refetchInterval: (query) => {
            // Poll while connecting
            if (query.state.data?.connecting) return 2000;
            // Poll for up to 15s after a config save to catch the transition
            // from offline → connecting → connected
            const elapsed = Date.now() - botConfigSavedAt.current;
            if (elapsed < 15_000 && !query.state.data?.connected) return 2000;
            return false;
        },
    });

    const updateDiscordBot = useMutation<ApiResponse, Error, DiscordBotConfigDto>({
        mutationFn: async (config) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify(config),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to update Discord bot configuration' }));
                throw new Error(error.message || 'Failed to update Discord bot configuration');
            }
            return response.json();
        },
        onSuccess: () => {
            botConfigSavedAt.current = Date.now();
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'discord-bot'] });
        },
    });

    const testDiscordBot = useMutation<DiscordBotTestResult, Error, { botToken?: string }>({
        mutationFn: async (body) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/test`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(body),
            });
            if (!response.ok) throw new Error('Failed to test Discord bot connection');
            return response.json();
        },
    });

    const clearDiscordBot = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/clear`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to clear Discord bot configuration');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'discord-bot'] });
        },
    });

    const checkDiscordBotPermissions = useMutation<DiscordBotPermissionsResult, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/permissions`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to check Discord bot permissions');
            return response.json();
        },
    });

    // ============================================================
    // Discord Bot Channel Selection (ROK-118)
    // ============================================================

    const discordChannels = useQuery<{ id: string; name: string }[]>({
        queryKey: ['admin', 'settings', 'discord-bot', 'channels'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/channels`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch Discord channels');
            return response.json();
        },
        enabled: !!getAuthToken() && !!discordBotStatus.data?.connected,
        staleTime: 30_000,
    });

    const discordDefaultChannel = useQuery<{ channelId: string | null }>({
        queryKey: ['admin', 'settings', 'discord-bot', 'channel'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/channel`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch default channel');
            return response.json();
        },
        enabled: !!getAuthToken() && !!discordBotStatus.data?.connected,
        staleTime: 30_000,
    });

    const setDiscordChannel = useMutation<ApiResponse, Error, string>({
        mutationFn: async (channelId) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/channel`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ channelId }),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to set default channel' }));
                throw new Error(error.message || 'Failed to set default channel');
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'discord-bot', 'channel'] });
        },
    });

    // ============================================================
    // Discord Bot Setup Wizard (ROK-349)
    // ============================================================

    const resendSetupWizard = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/resend-setup`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to send setup wizard' }));
                throw new Error(error.message || 'Failed to send setup wizard');
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'discord-bot'] });
        },
    });

    // ============================================================
    // Discord Bot Voice Channel Selection (ROK-471)
    // ============================================================

    const botConnected = !!discordBotStatus.data?.connected;

    const discordVoiceChannels = useQuery<{ id: string; name: string }[]>({
        queryKey: ['admin', 'settings', 'discord-bot', 'voice-channels', { botConnected }],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/voice-channels`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch Discord voice channels');
            return response.json();
        },
        enabled: !!getAuthToken() && botConnected,
        staleTime: 30_000,
    });

    const discordDefaultVoiceChannel = useQuery<{ channelId: string | null }>({
        queryKey: ['admin', 'settings', 'discord-bot', 'voice-channel'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/voice-channel`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch default voice channel');
            return response.json();
        },
        enabled: !!getAuthToken() && !!discordBotStatus.data?.connected,
        staleTime: 30_000,
    });

    const setDiscordVoiceChannel = useMutation<ApiResponse, Error, string>({
        mutationFn: async (channelId) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/voice-channel`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ channelId }),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to set default voice channel' }));
                throw new Error(error.message || 'Failed to set default voice channel');
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'discord-bot', 'voice-channel'] });
        },
    });

    // ROK-293: Ad-hoc events toggle
    const adHocEventsStatus = useQuery<{ enabled: boolean }>({
        queryKey: ['admin', 'settings', 'discord-bot', 'ad-hoc'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/ad-hoc`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch ad-hoc events status');
            return response.json();
        },
        enabled: !!getAuthToken() && !!discordBotStatus.data?.connected,
    });

    const updateAdHocEvents = useMutation<ApiResponse, Error, { enabled: boolean }>({
        mutationFn: async (data) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/discord-bot/ad-hoc`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify(data),
            });
            if (!response.ok) throw new Error('Failed to update ad-hoc events setting');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'discord-bot', 'ad-hoc'] });
        },
    });

    return {
        oauthStatus,
        updateOAuth,
        testOAuth,
        clearOAuth,
        igdbStatus,
        updateIgdb,
        testIgdb,
        clearIgdb,
        blizzardStatus,
        updateBlizzard,
        testBlizzard,
        clearBlizzard,
        igdbAdultFilter,
        updateAdultFilter,
        igdbSyncStatus,
        syncIgdb,
        demoDataStatus,
        installDemoData,
        clearDemoData,
        defaultTimezone,
        updateTimezone,
        discordBotStatus,
        updateDiscordBot,
        testDiscordBot,
        clearDiscordBot,
        checkDiscordBotPermissions,
        discordChannels,
        discordDefaultChannel,
        setDiscordChannel,
        resendSetupWizard,
        discordVoiceChannels,
        discordDefaultVoiceChannel,
        setDiscordVoiceChannel,
        adHocEventsStatus,
        updateAdHocEvents,
    };
}
