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

/**
 * ROK-2162: root of the query keys whose server state depends on the Blizzard
 * API keys. Core owns it; plugin keys build on it (plugin imports core, never
 * the reverse), so a save's invalidation cannot drift from them. A save
 * re-reads everything under it, the WoW plugin's quest import report and
 * namespace probe state included.
 */
export const BLIZZARD_DEPENDENT_QUERY_ROOT = ['admin', 'blizzard'] as const;

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
        // ROK-2162: saved keys can start the WoW Forever quest import server-side. Best effort:
        // the server kick is fire-and-forget, so this refetch may still read idle; the panel's
        // 30 s idle poll is what reliably catches the run.
        queryClient.invalidateQueries({ queryKey: [...BLIZZARD_DEPENDENT_QUERY_ROOT] });
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
