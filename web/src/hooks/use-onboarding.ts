import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import { toast } from '../lib/toast';
import type {
  OnboardingStatusDto,
  DataSourceStatusDto,
} from '@raid-ledger/contract';

/**
 * Hook for the admin onboarding wizard (ROK-204).
 */
export function useOnboarding() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['admin', 'onboarding', 'status'],
    queryFn: () => fetchApi<OnboardingStatusDto>('/admin/onboarding/status'),
    staleTime: 30_000,
  });

  const dataSourcesQuery = useQuery({
    queryKey: ['admin', 'onboarding', 'data-sources'],
    queryFn: () =>
      fetchApi<DataSourceStatusDto>('/admin/onboarding/data-sources'),
    staleTime: 30_000,
  });

  const changePassword = useMutation({
    mutationFn: async (data: {
      currentPassword: string;
      newPassword: string;
    }) => {
      return fetchApi<{ success: boolean; message: string }>(
        '/admin/onboarding/change-password',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
      );
    },
    onSuccess: () => {
      toast.success('Password changed successfully');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'onboarding', 'status'],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to change password');
    },
  });

  const updateCommunity = useMutation({
    mutationFn: async (data: {
      communityName?: string;
      defaultTimezone?: string;
    }) => {
      return fetchApi<{ success: boolean; message: string }>(
        '/admin/onboarding/community',
        {
          method: 'PATCH',
          body: JSON.stringify(data),
        },
      );
    },
    onSuccess: () => {
      toast.success('Community settings saved');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'onboarding', 'status'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'branding'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['system', 'status'],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save community settings');
    },
  });

  const updateStep = useMutation({
    mutationFn: async (step: number) => {
      return fetchApi<{ success: boolean; step: number }>(
        '/admin/onboarding/step',
        {
          method: 'PATCH',
          body: JSON.stringify({ step }),
        },
      );
    },
  });

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      return fetchApi<{ success: boolean }>('/admin/onboarding/complete', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'onboarding', 'status'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['system', 'status'],
      });
    },
  });

  const resetOnboarding = useMutation({
    mutationFn: async () => {
      return fetchApi<{ success: boolean }>('/admin/onboarding/reset', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      toast.success('Setup wizard has been reset');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'onboarding', 'status'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['system', 'status'],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to reset setup wizard');
    },
  });

  // Save Blizzard config (reuses existing admin settings endpoint)
  const saveBlizzardConfig = useMutation({
    mutationFn: async (data: { clientId: string; clientSecret: string }) => {
      return fetchApi<{ success: boolean; message: string }>(
        '/admin/settings/blizzard',
        {
          method: 'PUT',
          body: JSON.stringify(data),
        },
      );
    },
    onSuccess: () => {
      toast.success('Blizzard API credentials saved');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'onboarding', 'data-sources'],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save Blizzard config');
    },
  });

  // Test Blizzard config
  const testBlizzardConfig = useMutation({
    mutationFn: async () => {
      return fetchApi<{ success: boolean; message: string }>(
        '/admin/settings/blizzard/test',
        { method: 'POST' },
      );
    },
  });

  // Save IGDB config (reuses existing admin settings endpoint)
  const saveIgdbConfig = useMutation({
    mutationFn: async (data: { clientId: string; clientSecret: string }) => {
      return fetchApi<{ success: boolean; message: string }>(
        '/admin/settings/igdb',
        {
          method: 'PUT',
          body: JSON.stringify(data),
        },
      );
    },
    onSuccess: () => {
      toast.success('IGDB/Twitch credentials saved');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'onboarding', 'data-sources'],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save IGDB config');
    },
  });

  // Test IGDB config
  const testIgdbConfig = useMutation({
    mutationFn: async () => {
      return fetchApi<{ success: boolean; message: string }>(
        '/admin/settings/igdb/test',
        { method: 'POST' },
      );
    },
  });

  return {
    statusQuery,
    dataSourcesQuery,
    changePassword,
    updateCommunity,
    updateStep,
    completeOnboarding,
    resetOnboarding,
    saveBlizzardConfig,
    testBlizzardConfig,
    saveIgdbConfig,
    testIgdbConfig,
  };
}
