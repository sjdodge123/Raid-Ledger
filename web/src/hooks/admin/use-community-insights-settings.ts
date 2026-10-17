/**
 * Admin hook for Community Insights persistent settings (ROK-1099).
 * Reads + writes the churn-threshold default consumed by the nightly
 * snapshot cron.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';

const KEY = ['admin', 'settings', 'community-insights'] as const;

interface CommunityInsightsSettings {
    churnThresholdPct: number;
}

interface ApiResponse {
    success: boolean;
    message: string;
}

export function useCommunityInsightsSettings() {
    const queryClient = useQueryClient();

    const settings = useQuery<CommunityInsightsSettings>({
        queryKey: [...KEY],
        queryFn: () => adminFetch('/admin/settings/community-insights'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const updateSettings = useMutation<ApiResponse, Error, Partial<CommunityInsightsSettings>>({
        mutationFn: (config) =>
            adminFetch('/admin/settings/community-insights', {
                method: 'PUT',
                body: JSON.stringify(config),
            }, 'Failed to update Community Insights settings'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...KEY] }),
    });

    return { settings, updateSettings };
}
