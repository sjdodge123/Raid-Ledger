import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type {
    IgdbStatusResponse,
    IgdbSyncStatus,
    IgdbConfigDto,
    OAuthTestResponse,
    ApiResponse,
} from './admin-settings-types';

/** IGDB settings queries and mutations */
export function useIgdbSettings() {
    const queryClient = useQueryClient();

    const igdbStatus = useQuery<IgdbStatusResponse>({
        queryKey: ['admin', 'settings', 'igdb'],
        queryFn: () => adminFetch('/admin/settings/igdb'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateIgdb = useMutation<ApiResponse, Error, IgdbConfigDto>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/igdb', {
                method: 'PUT',
                body: JSON.stringify(config),
            }, 'Failed to update IGDB configuration'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb'] });
        },
    });

    const testIgdb = useMutation<OAuthTestResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/igdb/test', {
                method: 'POST',
            }, 'Failed to test IGDB configuration'),
    });

    const clearIgdb = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/igdb/clear', {
                method: 'POST',
            }, 'Failed to clear IGDB configuration'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb'] });
        },
    });

    const igdbAdultFilter = useQuery<{ enabled: boolean }>({
        queryKey: ['admin', 'settings', 'igdb', 'adult-filter'],
        queryFn: () => adminFetch('/admin/settings/igdb/adult-filter'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateAdultFilter = useMutation<
        ApiResponse & { hiddenCount?: number },
        Error,
        boolean
    >({
        mutationFn: (enabled) =>
            adminFetch('/admin/settings/igdb/adult-filter', {
                method: 'PUT',
                body: JSON.stringify({ enabled }),
            }, 'Failed to update adult filter'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb', 'adult-filter'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'games'] });
        },
    });

    const igdbSyncStatus = useQuery<IgdbSyncStatus>({
        queryKey: ['admin', 'settings', 'igdb', 'sync-status'],
        queryFn: () => adminFetch('/admin/settings/igdb/sync-status'),
        enabled: !!getAuthToken(),
        staleTime: 10_000,
    });

    const syncIgdb = useMutation<
        ApiResponse & { refreshed: number; discovered: number },
        Error
    >({
        mutationFn: () =>
            adminFetch('/admin/settings/igdb/sync', {
                method: 'POST',
            }, 'Failed to trigger sync'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb', 'sync-status'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb'] });
        },
    });

    return {
        igdbStatus,
        updateIgdb,
        testIgdb,
        clearIgdb,
        igdbAdultFilter,
        updateAdultFilter,
        igdbSyncStatus,
        syncIgdb,
    };
}
