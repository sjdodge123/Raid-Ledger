import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type {
    BlizzardStatusResponse,
    BlizzardConfigDto,
    OAuthTestResponse,
    ApiResponse,
} from './admin-settings-types';

const BLIZZARD_KEY = ['admin', 'settings', 'blizzard'] as const;

function useBlizzardStatusQuery() {
    return useQuery<BlizzardStatusResponse>({
        queryKey: [...BLIZZARD_KEY],
        queryFn: () => adminFetch('/admin/settings/blizzard'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

function useBlizzardMutations() {
    const queryClient = useQueryClient();

    const invalidateBlizzard = () => {
        queryClient.invalidateQueries({ queryKey: [...BLIZZARD_KEY] });
        queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
    };

    const updateBlizzard = useMutation<ApiResponse, Error, BlizzardConfigDto>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/blizzard', {
                method: 'PUT', body: JSON.stringify(config),
            }, 'Failed to update Blizzard configuration'),
        onSuccess: invalidateBlizzard,
    });

    const testBlizzard = useMutation<OAuthTestResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/blizzard/test', { method: 'POST' }, 'Failed to test Blizzard configuration'),
    });

    const clearBlizzard = useMutation<ApiResponse, Error>({
        mutationFn: () =>
            adminFetch('/admin/settings/blizzard/clear', { method: 'POST' }, 'Failed to clear Blizzard configuration'),
        onSuccess: invalidateBlizzard,
    });

    return { updateBlizzard, testBlizzard, clearBlizzard };
}

/** Blizzard API settings queries and mutations */
export function useBlizzardSettings() {
    const blizzardStatus = useBlizzardStatusQuery();
    const mutations = useBlizzardMutations();
    return { blizzardStatus, ...mutations };
}
