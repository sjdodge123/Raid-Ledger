/**
 * Admin hook for lineup phase duration defaults (ROK-946).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';

const LINEUP_KEY = ['admin', 'settings', 'lineup'] as const;

interface LineupDefaults {
  buildingDurationHours: number;
  votingDurationHours: number;
  decidedDurationHours: number;
}

interface ApiResponse {
  success: boolean;
  message: string;
}

export function useLineupSettings() {
  const queryClient = useQueryClient();

  const lineupDefaults = useQuery<LineupDefaults>({
    queryKey: [...LINEUP_KEY],
    queryFn: () => adminFetch('/admin/settings/lineup'),
    enabled: !!getAuthToken(),
    staleTime: 30_000,
  });

  const updateDefaults = useMutation<ApiResponse, Error, Partial<LineupDefaults>>({
    mutationFn: (config) =>
      adminFetch('/admin/settings/lineup', {
        method: 'PUT',
        body: JSON.stringify(config),
      }, 'Failed to update lineup defaults'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...LINEUP_KEY] }),
  });

  return { lineupDefaults, updateDefaults };
}
