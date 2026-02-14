import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CronJobDto, CronJobExecutionDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

/**
 * Hook for cron job management API operations (ROK-310).
 * Follows the same pattern as use-admin-settings.ts.
 */
export function useCronJobs() {
    const queryClient = useQueryClient();

    const getHeaders = () => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    });

    // GET /admin/cron-jobs — List all registered cron jobs
    const cronJobs = useQuery<CronJobDto[]>({
        queryKey: ['admin', 'cron-jobs'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/cron-jobs`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch cron jobs');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 15_000,
    });

    // PATCH /admin/cron-jobs/:id/pause
    const pauseJob = useMutation<CronJobDto, Error, number>({
        mutationFn: async (id) => {
            const response = await fetch(`${API_BASE_URL}/admin/cron-jobs/${id}/pause`, {
                method: 'PATCH',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to pause cron job');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs'] });
        },
    });

    // PATCH /admin/cron-jobs/:id/resume
    const resumeJob = useMutation<CronJobDto, Error, number>({
        mutationFn: async (id) => {
            const response = await fetch(`${API_BASE_URL}/admin/cron-jobs/${id}/resume`, {
                method: 'PATCH',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to resume cron job');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs'] });
        },
    });

    // PATCH /admin/cron-jobs/:id/schedule
    const updateSchedule = useMutation<CronJobDto, Error, { id: number; cronExpression: string }>({
        mutationFn: async ({ id, cronExpression }) => {
            const response = await fetch(`${API_BASE_URL}/admin/cron-jobs/${id}/schedule`, {
                method: 'PATCH',
                headers: getHeaders(),
                body: JSON.stringify({ cronExpression }),
            });
            if (!response.ok) throw new Error('Failed to update cron schedule');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs'] });
        },
    });

    // POST /admin/cron-jobs/:id/run — Manually trigger
    const runJob = useMutation<CronJobDto, Error, number>({
        mutationFn: async (id) => {
            const response = await fetch(`${API_BASE_URL}/admin/cron-jobs/${id}/run`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to trigger cron job');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'cron-jobs'] });
        },
    });

    return {
        cronJobs,
        pauseJob,
        resumeJob,
        updateSchedule,
        runJob,
    };
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
