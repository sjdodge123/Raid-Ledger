import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type {
    AiStatusDto, AiModelDto, AiUsageDto, AiTestConnectionDto,
    AiProviderInfoDto, AiOllamaSetupDto,
} from '@raid-ledger/contract';

const AI_KEY = ['admin', 'ai'] as const;
const PROVIDERS_KEY = [...AI_KEY, 'providers'] as const;

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

/** Query all AI providers with status. */
export function useAiProviders() {
    return useQuery<AiProviderInfoDto[]>({
        queryKey: [...PROVIDERS_KEY],
        queryFn: () => adminFetch('/admin/ai/providers'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

/** Mutation to configure a provider (save API key/URL). */
export function useConfigureProvider() {
    const qc = useQueryClient();
    return useMutation<{ success: boolean }, Error, { key: string; apiKey?: string; url?: string; model?: string }>({
        mutationFn: ({ key, ...body }) =>
            adminFetch(`/admin/ai/providers/${key}/configure`, {
                method: 'POST',
                body: JSON.stringify(body),
            }, 'Failed to configure provider'),
        onSuccess: () => { void qc.invalidateQueries({ queryKey: [...PROVIDERS_KEY] }); },
    });
}

/** Mutation to activate a provider. */
export function useActivateProvider() {
    const qc = useQueryClient();
    return useMutation<{ success: boolean }, Error, string>({
        mutationFn: (key) =>
            adminFetch(`/admin/ai/providers/${key}/activate`, {
                method: 'POST',
            }, 'Failed to activate provider'),
        onSuccess: () => { void qc.invalidateQueries({ queryKey: [...AI_KEY] }); },
    });
}

/** Mutation to setup Ollama Docker. */
export function useOllamaSetup() {
    const qc = useQueryClient();
    return useMutation<AiOllamaSetupDto, Error>({
        mutationFn: () =>
            adminFetch('/admin/ai/providers/ollama/setup', {
                method: 'POST',
            }, 'Failed to setup Ollama'),
        onSuccess: () => { void qc.invalidateQueries({ queryKey: [...PROVIDERS_KEY] }); },
    });
}

/** Mutation to stop Ollama Docker. */
export function useOllamaStop() {
    const qc = useQueryClient();
    return useMutation<{ success: boolean }, Error>({
        mutationFn: () =>
            adminFetch('/admin/ai/providers/ollama/stop', {
                method: 'POST',
            }, 'Failed to stop Ollama'),
        onSuccess: () => { void qc.invalidateQueries({ queryKey: [...PROVIDERS_KEY] }); },
    });
}

/** Mutation to test chat with the active LLM. */
export function useTestChat() {
    return useMutation<{ success: boolean; response: string; latencyMs: number }, Error>({
        mutationFn: () =>
            adminFetch('/admin/ai/test-chat', {
                method: 'POST',
            }, 'Failed to test LLM'),
    });
}
