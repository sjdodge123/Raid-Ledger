import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import { toast } from '../lib/toast';
import type {
  OnboardingStatusDto,
  DataSourceStatusDto,
} from '@raid-ledger/contract';

const OB_STATUS_KEY = ['admin', 'onboarding', 'status'];
const OB_DATA_KEY = ['admin', 'onboarding', 'data-sources'];

function useOnboardingQueries() {
  const statusQuery = useQuery({
    queryKey: OB_STATUS_KEY,
    queryFn: () => fetchApi<OnboardingStatusDto>('/admin/onboarding/status'),
    staleTime: 30_000,
  });

  const dataSourcesQuery = useQuery({
    queryKey: OB_DATA_KEY,
    queryFn: () => fetchApi<DataSourceStatusDto>('/admin/onboarding/data-sources'),
    staleTime: 30_000,
  });

  return { statusQuery, dataSourcesQuery };
}

function useOnboardingCoreMutations() {
  const queryClient = useQueryClient();

  const changePassword = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      fetchApi<{ success: boolean; message: string }>('/admin/onboarding/change-password', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { toast.success('Password changed successfully'); void queryClient.invalidateQueries({ queryKey: OB_STATUS_KEY }); },
    onError: (err: Error) => { toast.error(err.message || 'Failed to change password'); },
  });

  const updateCommunity = useMutation({
    mutationFn: (data: { communityName?: string; defaultTimezone?: string }) =>
      fetchApi<{ success: boolean; message: string }>('/admin/onboarding/community', { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success('Community settings saved');
      void queryClient.invalidateQueries({ queryKey: OB_STATUS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['system', 'branding'] });
      void queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
    },
    onError: (err: Error) => { toast.error(err.message || 'Failed to save community settings'); },
  });

  const updateStep = useMutation({
    mutationFn: (step: number) =>
      fetchApi<{ success: boolean; step: number }>('/admin/onboarding/step', { method: 'PATCH', body: JSON.stringify({ step }) }),
  });

  return { changePassword, updateCommunity, updateStep };
}

function useOnboardingLifecycleMutations() {
  const queryClient = useQueryClient();
  const invalidateBoth = () => {
    void queryClient.invalidateQueries({ queryKey: OB_STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
  };

  const completeOnboarding = useMutation({
    mutationFn: () => fetchApi<{ success: boolean }>('/admin/onboarding/complete', { method: 'POST' }),
    onSuccess: invalidateBoth,
  });

  const resetOnboarding = useMutation({
    mutationFn: () => fetchApi<{ success: boolean }>('/admin/onboarding/reset', { method: 'POST' }),
    onSuccess: () => { toast.success('Setup wizard has been reset'); invalidateBoth(); },
    onError: (err: Error) => { toast.error(err.message || 'Failed to reset setup wizard'); },
  });

  return { completeOnboarding, resetOnboarding };
}

function useOnboardingDataSourceMutations() {
  const queryClient = useQueryClient();

  const saveBlizzardConfig = useMutation({
    mutationFn: (data: { clientId: string; clientSecret: string }) =>
      fetchApi<{ success: boolean; message: string }>('/admin/settings/blizzard', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => { toast.success('Blizzard API credentials saved'); void queryClient.invalidateQueries({ queryKey: OB_DATA_KEY }); },
    onError: (err: Error) => { toast.error(err.message || 'Failed to save Blizzard config'); },
  });

  const testBlizzardConfig = useMutation({
    mutationFn: () => fetchApi<{ success: boolean; message: string }>('/admin/settings/blizzard/test', { method: 'POST' }),
  });

  const saveIgdbConfig = useMutation({
    mutationFn: (data: { clientId: string; clientSecret: string }) =>
      fetchApi<{ success: boolean; message: string }>('/admin/settings/igdb', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => { toast.success('IGDB/Twitch credentials saved'); void queryClient.invalidateQueries({ queryKey: OB_DATA_KEY }); },
    onError: (err: Error) => { toast.error(err.message || 'Failed to save IGDB config'); },
  });

  const testIgdbConfig = useMutation({
    mutationFn: () => fetchApi<{ success: boolean; message: string }>('/admin/settings/igdb/test', { method: 'POST' }),
  });

  return { saveBlizzardConfig, testBlizzardConfig, saveIgdbConfig, testIgdbConfig };
}

/**
 * Hook for the admin onboarding wizard (ROK-204).
 */
export function useOnboarding() {
  return {
    ...useOnboardingQueries(),
    ...useOnboardingCoreMutations(),
    ...useOnboardingLifecycleMutations(),
    ...useOnboardingDataSourceMutations(),
  };
}
