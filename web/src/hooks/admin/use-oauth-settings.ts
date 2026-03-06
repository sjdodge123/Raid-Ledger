import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type {
    OAuthStatusResponse,
    OAuthConfigDto,
    OAuthTestResponse,
    ApiResponse,
} from './admin-settings-types';

/** OAuth settings query and mutations */
export function useOAuthSettings() {
    const queryClient = useQueryClient();

    const oauthStatus = useQuery<OAuthStatusResponse>({
        queryKey: ['admin', 'settings', 'oauth'],
        queryFn: () => adminFetch('/admin/settings/oauth'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateOAuth = useMutation<ApiResponse, Error, OAuthConfigDto>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/oauth', {
                method: 'PUT',
                body: JSON.stringify(config),
            }, 'Failed to update OAuth configuration'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'oauth'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
        },
    });

    const testOAuth = useMutation<OAuthTestResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/oauth/test', {
                method: 'POST',
            }, 'Failed to test OAuth configuration'),
    });

    const clearOAuth = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/oauth/clear', {
                method: 'POST',
            }, 'Failed to clear OAuth configuration'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'oauth'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
        },
    });

    return { oauthStatus, updateOAuth, testOAuth, clearOAuth };
}
