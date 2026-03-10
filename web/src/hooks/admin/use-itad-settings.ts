import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type { OAuthTestResponse, ApiResponse } from './admin-settings-types';

const ITAD_KEY = ['admin', 'settings', 'itad'] as const;

/**
 * Hook for ITAD admin settings API operations (ROK-772).
 */
export function useItadSettings() {
    const queryClient = useQueryClient();

    const itadStatus = useQuery<{ configured: boolean }>({
        queryKey: [...ITAD_KEY],
        queryFn: () => adminFetch('/admin/settings/itad'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateItad = useMutation<ApiResponse, Error, { apiKey: string }>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/itad', {
                method: 'PUT', body: JSON.stringify(config),
            }, 'Failed to update ITAD configuration'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...ITAD_KEY] }),
    });

    const testItad = useMutation<OAuthTestResponse, Error>({
        mutationFn: () => adminFetch('/admin/settings/itad/test', { method: 'POST' }, 'Failed to test ITAD configuration'),
    });

    const clearItad = useMutation<ApiResponse, Error>({
        mutationFn: () => adminFetch('/admin/settings/itad/clear', { method: 'POST' }, 'Failed to clear ITAD configuration'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...ITAD_KEY] }),
    });

    return { itadStatus, updateItad, testItad, clearItad };
}
