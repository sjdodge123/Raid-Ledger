import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type { OAuthTestResponse, ApiResponse } from './admin-settings-types';

const COOPTIMUS_KEY = ['admin', 'settings', 'cooptimus'] as const;

/**
 * Hook for Co-Optimus admin settings API operations (ROK-1397).
 * Stores the allowlisted user-agent the site grants us (permission-first).
 */
export function useCooptimusSettings() {
    const queryClient = useQueryClient();

    const cooptimusStatus = useQuery<{ configured: boolean }>({
        queryKey: [...COOPTIMUS_KEY],
        queryFn: () => adminFetch('/admin/settings/cooptimus'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateCooptimus = useMutation<ApiResponse, Error, { userAgent: string }>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/cooptimus', {
                method: 'PUT', body: JSON.stringify(config),
            }, 'Failed to update Co-Optimus configuration'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...COOPTIMUS_KEY] }),
    });

    const testCooptimus = useMutation<OAuthTestResponse, Error>({
        mutationFn: () => adminFetch('/admin/settings/cooptimus/test', { method: 'POST' }, 'Failed to test Co-Optimus configuration'),
    });

    const clearCooptimus = useMutation<ApiResponse, Error>({
        mutationFn: () => adminFetch('/admin/settings/cooptimus/clear', { method: 'POST' }, 'Failed to clear Co-Optimus configuration'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...COOPTIMUS_KEY] }),
    });

    return { cooptimusStatus, updateCooptimus, testCooptimus, clearCooptimus };
}
