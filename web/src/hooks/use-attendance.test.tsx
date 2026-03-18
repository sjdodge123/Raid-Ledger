/**
 * Tests for useRecordAttendance — verifies onSuccess cache invalidation
 * includes the metrics query key (ROK-852).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// --- API client mocks ---
const mockRecordAttendance = vi.fn();
const mockGetAttendanceSummary = vi.fn();

vi.mock('../lib/api-client', () => ({
    recordAttendance: (...args: unknown[]) => mockRecordAttendance(...args),
    getAttendanceSummary: (...args: unknown[]) => mockGetAttendanceSummary(...args),
}));

import { useRecordAttendance } from './use-attendance';

// --- Helpers ---

const EVENT_ID = 42;
const ATTENDANCE_KEY = ['events', EVENT_ID, 'attendance'] as const;
const ROSTER_KEY = ['events', EVENT_ID, 'roster'] as const;
const METRICS_KEY = ['events', EVENT_ID, 'metrics'] as const;

function createTestHarness() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });

    // Seed caches so invalidation calls can be observed
    queryClient.setQueryData([...ATTENDANCE_KEY], { attended: 0, noShow: 0, excused: 0 });
    queryClient.setQueryData([...ROSTER_KEY], { signups: [] });
    queryClient.setQueryData([...METRICS_KEY], { rosterBreakdown: [] });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    return { queryClient, invalidateSpy, wrapper };
}

function getInvalidateCalls(
    spy: ReturnType<typeof vi.spyOn>,
    key: readonly unknown[],
) {
    return spy.mock.calls.filter(
        ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify(key),
    );
}

// --- Tests ---

describe('useRecordAttendance — onSuccess cache invalidation (ROK-852)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('invalidates the metrics query key after recording attendance', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockRecordAttendance.mockResolvedValue({ id: 1, attendanceStatus: 'attended' });

        const { result } = renderHook(() => useRecordAttendance(EVENT_ID), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ signupId: 10, attendanceStatus: 'attended' });
        });

        const metricsCalls = getInvalidateCalls(invalidateSpy, [...METRICS_KEY]);
        expect(metricsCalls).toHaveLength(1);
    });

    it('invalidates the attendance query key after recording attendance', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockRecordAttendance.mockResolvedValue({ id: 1, attendanceStatus: 'no_show' });

        const { result } = renderHook(() => useRecordAttendance(EVENT_ID), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ signupId: 5, attendanceStatus: 'no_show' });
        });

        const attendanceCalls = getInvalidateCalls(invalidateSpy, [...ATTENDANCE_KEY]);
        expect(attendanceCalls).toHaveLength(1);
    });

    it('invalidates the roster query key after recording attendance', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockRecordAttendance.mockResolvedValue({ id: 1, attendanceStatus: 'excused' });

        const { result } = renderHook(() => useRecordAttendance(EVENT_ID), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ signupId: 7, attendanceStatus: 'excused' });
        });

        const rosterCalls = getInvalidateCalls(invalidateSpy, [...ROSTER_KEY]);
        expect(rosterCalls).toHaveLength(1);
    });

    it('invalidates all three query keys in a single mutation success', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockRecordAttendance.mockResolvedValue({ id: 1, attendanceStatus: 'attended' });

        const { result } = renderHook(() => useRecordAttendance(EVENT_ID), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ signupId: 20, attendanceStatus: 'attended' });
        });

        const metricsCalls = getInvalidateCalls(invalidateSpy, [...METRICS_KEY]);
        const attendanceCalls = getInvalidateCalls(invalidateSpy, [...ATTENDANCE_KEY]);
        const rosterCalls = getInvalidateCalls(invalidateSpy, [...ROSTER_KEY]);

        expect(metricsCalls).toHaveLength(1);
        expect(attendanceCalls).toHaveLength(1);
        expect(rosterCalls).toHaveLength(1);
    });

    it('does not invalidate metrics when the mutation fails', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockRecordAttendance.mockRejectedValue(new Error('network error'));

        const { result } = renderHook(() => useRecordAttendance(EVENT_ID), { wrapper });

        await act(async () => {
            await result.current.mutate({ signupId: 99, attendanceStatus: 'attended' });
        });

        const metricsCalls = getInvalidateCalls(invalidateSpy, [...METRICS_KEY]);
        expect(metricsCalls).toHaveLength(0);
    });

    it('scopes invalidation to the correct eventId, not other events', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockRecordAttendance.mockResolvedValue({ id: 1, attendanceStatus: 'attended' });

        const { result } = renderHook(() => useRecordAttendance(EVENT_ID), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ signupId: 10, attendanceStatus: 'attended' });
        });

        // The metrics key for a different event should NOT be invalidated
        const wrongMetricsKey = ['events', EVENT_ID + 1, 'metrics'] as const;
        const wrongCalls = getInvalidateCalls(invalidateSpy, [...wrongMetricsKey]);
        expect(wrongCalls).toHaveLength(0);
    });
});
