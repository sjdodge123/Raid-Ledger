import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';

const API_BASE = 'http://localhost:3000';

// Mock auth token
vi.mock('./use-auth', () => ({
    getAuthToken: () => 'test-token',
}));

// Mock toast
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('../lib/toast', () => ({
    toast: {
        success: (...args: unknown[]) => mockToastSuccess(...args),
        error: (...args: unknown[]) => mockToastError(...args),
    },
}));

import { useCronJobs } from './use-cron-jobs';

const MOCK_JOB = {
    id: 42,
    name: 'sync-games',
    description: 'Syncs games from IGDB',
    cronExpression: '0 3 * * *',
    paused: false,
    category: 'System',
    source: 'core',
    pluginSlug: null,
    lastRunAt: null,
};

function createWrapper(): {
    wrapper: ({ children }: { children: ReactNode }) => ReactNode;
    queryClient: QueryClient;
} {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

    return { wrapper, queryClient };
}

function setupCronJobsHandlers(): void {
    server.use(
        http.get(`${API_BASE}/admin/cron-jobs`, () =>
            HttpResponse.json([MOCK_JOB]),
        ),
    );
}

function setupRunSuccess(): void {
    server.use(
        http.post(`${API_BASE}/admin/cron-jobs/:id/run`, () =>
            HttpResponse.json(MOCK_JOB),
        ),
    );
}

describe('useCronJobs — runJob toast feedback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        setupCronJobsHandlers();
    });

    it('shows success toast with job name after run completes', async () => {
        setupRunSuccess();
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useCronJobs(), { wrapper });

        await waitFor(() => expect(result.current.cronJobs.isSuccess).toBe(true));

        await act(async () => { await result.current.runJob.mutateAsync(42); });

        expect(mockToastSuccess).toHaveBeenCalledWith(
            expect.stringContaining('sync-games'),
        );
    });

    it('shows error toast when run fails', async () => {
        server.use(
            http.post(`${API_BASE}/admin/cron-jobs/:id/run`, () =>
                HttpResponse.json({ error: 'fail' }, { status: 500 }),
            ),
        );
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useCronJobs(), { wrapper });

        await waitFor(() => expect(result.current.cronJobs.isSuccess).toBe(true));

        await act(async () => {
            try { await result.current.runJob.mutateAsync(42); }
            catch { /* expected — mutation rejects on HTTP error */ }
        });

        expect(mockToastError).toHaveBeenCalledWith(
            expect.stringContaining('Failed'),
        );
    });
});

describe('useCronJobs — runJob query invalidation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        setupCronJobsHandlers();
    });

    it('invalidates execution history queries on success', async () => {
        setupRunSuccess();
        const { wrapper, queryClient } = createWrapper();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useCronJobs(), { wrapper });

        await waitFor(() => expect(result.current.cronJobs.isSuccess).toBe(true));

        await act(async () => { await result.current.runJob.mutateAsync(42); });

        expect(invalidateSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                queryKey: ['admin', 'cron-jobs', 42, 'executions'],
            }),
        );
    });

    it('schedules delayed re-invalidation after success', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        setupRunSuccess();

        const { wrapper, queryClient } = createWrapper();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useCronJobs(), { wrapper });

        await waitFor(() => expect(result.current.cronJobs.isSuccess).toBe(true));

        await act(async () => { await result.current.runJob.mutateAsync(42); });

        invalidateSpy.mockClear();

        await act(async () => { vi.advanceTimersByTime(3000); });

        expect(invalidateSpy).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: ['admin', 'cron-jobs'] }),
        );
        expect(invalidateSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                queryKey: ['admin', 'cron-jobs', 42, 'executions'],
            }),
        );

        vi.useRealTimers();
    });
});
