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
    // GitHub Feedback Integration (ROK-186)
    // ============================================================

    const githubStatus = useQuery<{ configured: boolean }>({
        queryKey: ['admin', 'settings', 'github'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/github`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch GitHub status');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateGitHub = useMutation<ApiResponse, Error, { token: string }>({
        mutationFn: async (config) => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/github`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify(config),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to update GitHub configuration' }));
                throw new Error(error.message || 'Failed to update GitHub configuration');
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'github'] });
        },
    });

    const testGitHub = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/github/test`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to test GitHub configuration');
            return response.json();
        },
    });

    const clearGitHub = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/settings/github/clear`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to clear GitHub configuration');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'github'] });
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
        igdbSyncStatus,
        syncIgdb,
        demoDataStatus,
        installDemoData,
        clearDemoData,
        githubStatus,
        updateGitHub,
        testGitHub,
        clearGitHub,
    };
}
