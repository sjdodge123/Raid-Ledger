import { useQuery, useMutation } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type { AiStatusDto, AiModelDto, AiUsageDto, AiTestConnectionDto } from '@raid-ledger/contract';

const AI_KEY = ['admin', 'ai'] as const;

/** Query the AI provider status. */
export function useAiStatus() {
    return useQuery<AiStatusDto>({
        queryKey: [...AI_KEY, 'status'],
        queryFn: () => adminFetch('/admin/ai/status'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

/** Query the list of available AI models. */
export function useAiModels() {
    return useQuery<AiModelDto[]>({
        queryKey: [...AI_KEY, 'models'],
        queryFn: () => adminFetch('/admin/ai/models'),
        enabled: !!getAuthToken(),
        staleTime: 60_000,
    });
}

/** Query AI usage statistics. */
export function useAiUsage() {
    return useQuery<AiUsageDto>({
        queryKey: [...AI_KEY, 'usage'],
        queryFn: () => adminFetch('/admin/ai/usage'),
        enabled: !!getAuthToken(),
        staleTime: 60_000,
    });
}

/** Mutation to test the AI provider connection. */
export function useTestAiConnection() {
    return useMutation<AiTestConnectionDto, Error>({
        mutationFn: () =>
            adminFetch('/admin/ai/test-connection', {
                method: 'POST',
            }, 'Failed to test AI connection'),
    });
}
