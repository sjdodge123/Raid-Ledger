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

const IGDB_KEY = ['admin', 'settings', 'igdb'] as const;

function useIgdbCoreMutations() {
    const queryClient = useQueryClient();

    const igdbStatus = useQuery<IgdbStatusResponse>({
        queryKey: [...IGDB_KEY],
        queryFn: () => adminFetch('/admin/settings/igdb'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateIgdb = useMutation<ApiResponse, Error, IgdbConfigDto>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/igdb', {
                method: 'PUT', body: JSON.stringify(config),
            }, 'Failed to update IGDB configuration'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...IGDB_KEY] }),
    });

    const testIgdb = useMutation<OAuthTestResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/igdb/test', { method: 'POST' }, 'Failed to test IGDB configuration'),
    });

    const clearIgdb = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/igdb/clear', { method: 'POST' }, 'Failed to clear IGDB configuration'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...IGDB_KEY] }),
    });

    return { igdbStatus, updateIgdb, testIgdb, clearIgdb };
}

function useIgdbAdultFilterSettings() {
    const queryClient = useQueryClient();

    const igdbAdultFilter = useQuery<{ enabled: boolean }>({
        queryKey: [...IGDB_KEY, 'adult-filter'],
        queryFn: () => adminFetch('/admin/settings/igdb/adult-filter'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateAdultFilter = useMutation<ApiResponse & { hiddenCount?: number }, Error, boolean>({
        mutationFn: (enabled) =>
            adminFetch('/admin/settings/igdb/adult-filter', {
                method: 'PUT', body: JSON.stringify({ enabled }),
            }, 'Failed to update adult filter'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [...IGDB_KEY, 'adult-filter'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'games'] });
        },
    });

    return { igdbAdultFilter, updateAdultFilter };
}

function useIgdbSyncSettings() {
    const queryClient = useQueryClient();

    const igdbSyncStatus = useQuery<IgdbSyncStatus>({
        queryKey: [...IGDB_KEY, 'sync-status'],
        queryFn: () => adminFetch('/admin/settings/igdb/sync-status'),
        enabled: !!getAuthToken(),
        staleTime: 10_000,
    });

    const syncIgdb = useMutation<ApiResponse & { refreshed: number; discovered: number }, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/igdb/sync', { method: 'POST' }, 'Failed to trigger sync'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [...IGDB_KEY, 'sync-status'] });
            queryClient.invalidateQueries({ queryKey: [...IGDB_KEY] });
        },
    });

    return { igdbSyncStatus, syncIgdb };
}

/** IGDB settings queries and mutations */
export function useIgdbSettings() {
    return {
        ...useIgdbCoreMutations(),
        ...useIgdbAdultFilterSettings(),
        ...useIgdbSyncSettings(),
    };
}
