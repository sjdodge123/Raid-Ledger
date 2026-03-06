import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type {
    BlizzardStatusResponse,
    BlizzardConfigDto,
    OAuthTestResponse,
    ApiResponse,
} from './admin-settings-types';

/** Blizzard API settings queries and mutations */
export function useBlizzardSettings() {
    const queryClient = useQueryClient();

    const blizzardStatus = useQuery<BlizzardStatusResponse>({
        queryKey: ['admin', 'settings', 'blizzard'],
        queryFn: () => adminFetch('/admin/settings/blizzard'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateBlizzard = useMutation<
        ApiResponse,
        Error,
        BlizzardConfigDto
    >({
        mutationFn: (config) =>
            adminFetch('/admin/settings/blizzard', {
                method: 'PUT',
                body: JSON.stringify(config),
            }, 'Failed to update Blizzard configuration'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'blizzard'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
        },
    });

    const testBlizzard = useMutation<OAuthTestResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/blizzard/test', {
                method: 'POST',
            }, 'Failed to test Blizzard configuration'),
    });

    const clearBlizzard = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/blizzard/clear', {
                method: 'POST',
            }, 'Failed to clear Blizzard configuration'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'blizzard'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
        },
    });

    return { blizzardStatus, updateBlizzard, testBlizzard, clearBlizzard };
}
