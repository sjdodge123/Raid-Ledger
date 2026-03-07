import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type {
    OAuthStatusResponse,
    OAuthConfigDto,
    OAuthTestResponse,
    ApiResponse,
} from './admin-settings-types';

const OAUTH_KEY = ['admin', 'settings', 'oauth'] as const;

function useOAuthStatusQuery() {
    return useQuery<OAuthStatusResponse>({
        queryKey: [...OAUTH_KEY],
        queryFn: () => adminFetch('/admin/settings/oauth'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

function useOAuthMutations() {
    const queryClient = useQueryClient();

    const invalidateOAuth = () => {
        queryClient.invalidateQueries({ queryKey: [...OAUTH_KEY] });
        queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
    };

    const updateOAuth = useMutation<ApiResponse, Error, OAuthConfigDto>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/oauth', {
                method: 'PUT', body: JSON.stringify(config),
            }, 'Failed to update OAuth configuration'),
        onSuccess: invalidateOAuth,
    });

    const testOAuth = useMutation<OAuthTestResponse, Error>({
        mutationFn: () => adminFetch('/admin/settings/oauth/test', { method: 'POST' }, 'Failed to test OAuth configuration'),
    });

    const clearOAuth = useMutation<ApiResponse, Error>({
        mutationFn: () => adminFetch('/admin/settings/oauth/clear', { method: 'POST' }, 'Failed to clear OAuth configuration'),
        onSuccess: invalidateOAuth,
    });

    return { updateOAuth, testOAuth, clearOAuth };
}

/** OAuth settings query and mutations */
export function useOAuthSettings() {
    const oauthStatus = useOAuthStatusQuery();
    return { oauthStatus, ...useOAuthMutations() };
}
