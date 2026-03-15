import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CronJobDto, CronJobExecutionDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import { toast } from '../lib/toast';

/**
 * Hook for cron job management API operations (ROK-310).
 * Follows the same pattern as use-admin-settings.ts.
 */
function cronHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken() || ''}` };
}

async function cronFetch<T>(path: string, method: string, errorMsg: string, body?: string): Promise<T> {
    const opts: RequestInit = { method, headers: cronHeaders() };
    if (body) opts.body = body;
    const response = await fetch(`${API_BASE_URL}${path}`, opts);
    if (!response.ok) throw new Error(errorMsg);
    return response.json();
}

/** Delay (ms) before re-invalidating to catch async execution records from core jobs. */
const REFETCH_DELAY_MS = 3000;

/** Handles runJob success: shows toast and invalidates execution history. */
function onRunSuccess(queryClient: ReturnType<typeof useQueryClient>, data: CronJobDto, id: number): void {
    queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs'] });
    toast.success(`Triggered "${data.name}"`);
    queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs', id, 'executions'] });
    setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs', id, 'executions'] });
    }, REFETCH_DELAY_MS);
}

function useCronJobMutations() {
    const queryClient = useQueryClient();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs'] });

    const pauseJob = useMutation<CronJobDto, Error, number>({
        mutationFn: (id) => cronFetch(`/admin/cron-jobs/${id}/pause`, 'PATCH', 'Failed to pause cron job'),
        onSuccess: invalidate,
    });

    const resumeJob = useMutation<CronJobDto, Error, number>({
        mutationFn: (id) => cronFetch(`/admin/cron-jobs/${id}/resume`, 'PATCH', 'Failed to resume cron job'),
        onSuccess: invalidate,
    });

    const updateSchedule = useMutation<CronJobDto, Error, { id: number; cronExpression: string }>({
        mutationFn: ({ id, cronExpression }) =>
            cronFetch(`/admin/cron-jobs/${id}/schedule`, 'PATCH', 'Failed to update cron schedule', JSON.stringify({ cronExpression })),
        onSuccess: invalidate,
    });

    const runJob = useMutation<CronJobDto, Error, number>({
        mutationFn: (id) => cronFetch(`/admin/cron-jobs/${id}/run`, 'POST', 'Failed to trigger cron job'),
        onSuccess: (data, id) => onRunSuccess(queryClient, data, id),
        onError: () => { toast.error('Failed to trigger cron job'); },
    });

    return { pauseJob, resumeJob, updateSchedule, runJob };
}

export function useCronJobs() {
    const cronJobs = useQuery<CronJobDto[]>({
        queryKey: ['admin', 'cron-jobs'],
        queryFn: () => cronFetch('/admin/cron-jobs', 'GET', 'Failed to fetch cron jobs'),
        enabled: !!getAuthToken(),
        staleTime: 15_000,
    });
    return { cronJobs, ...useCronJobMutations() };
}

/**
 * Hook to fetch execution history for a specific cron job.
 */
export function useCronJobExecutions(jobId: number | null) {
    const getHeaders = () => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    });

    return useQuery<CronJobExecutionDto[]>({
        queryKey: ['admin', 'cron-jobs', jobId, 'executions'],
        queryFn: async () => {
            const response = await fetch(
                `${API_BASE_URL}/admin/cron-jobs/${jobId}/executions?limit=50`,
                { headers: getHeaders() },
            );
            if (!response.ok) throw new Error('Failed to fetch execution history');
            return response.json();
        },
        enabled: !!getAuthToken() && jobId !== null,
        staleTime: 10_000,
    });
}
