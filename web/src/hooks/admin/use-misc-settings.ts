import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type {
    DemoDataStatus,
    DemoDataResult,
    OAuthTestResponse,
    ApiResponse,
} from './admin-settings-types';

/** Demo data, timezone, and Steam settings */
export function useMiscSettings() {
    const queryClient = useQueryClient();

    // -- Demo Data (ROK-193) --

    const demoDataStatus = useQuery<DemoDataStatus>({
        queryKey: ['admin', 'settings', 'demo', 'status'],
        queryFn: () => adminFetch('/admin/settings/demo/status'),
        enabled: !!getAuthToken(),
        staleTime: 10_000,
    });

    const installDemoData = useMutation<DemoDataResult, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/demo/install', {
                method: 'POST',
            }, 'Failed to install demo data'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'demo', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['events'] });
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
    });

    const clearDemoData = useMutation<DemoDataResult, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/demo/clear', {
                method: 'POST',
            }, 'Failed to clear demo data'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'demo', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['events'] });
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
    });

    // -- Default Timezone (ROK-431) --

    const defaultTimezone = useQuery<{ timezone: string | null }>({
        queryKey: ['admin', 'settings', 'timezone'],
        queryFn: () => adminFetch('/admin/settings/timezone'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateTimezone = useMutation<ApiResponse, Error, string>({
        mutationFn: (timezone) =>
            adminFetch('/admin/settings/timezone', {
                method: 'PUT',
                body: JSON.stringify({ timezone }),
            }, 'Failed to update timezone'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'timezone'] });
        },
    });

    // -- Steam API Key (ROK-417) --

    const steamStatus = useQuery<{ configured: boolean }>({
        queryKey: ['admin', 'settings', 'steam'],
        queryFn: () => adminFetch('/admin/settings/steam'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateSteam = useMutation<
        ApiResponse,
        Error,
        { apiKey: string }
    >({
        mutationFn: (config) =>
            adminFetch('/admin/settings/steam', {
                method: 'PUT',
                body: JSON.stringify(config),
            }, 'Failed to update Steam configuration'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'steam'] });
        },
    });

    const testSteam = useMutation<OAuthTestResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/steam/test', {
                method: 'POST',
            }, 'Failed to test Steam configuration'),
    });

    const clearSteam = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/steam/clear', {
                method: 'POST',
            }, 'Failed to clear Steam configuration'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'steam'] });
        },
    });

    return {
        demoDataStatus,
        installDemoData,
        clearDemoData,
        defaultTimezone,
        updateTimezone,
        steamStatus,
        updateSteam,
        testSteam,
        clearSteam,
    };
}
