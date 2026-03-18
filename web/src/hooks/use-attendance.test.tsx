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

async function mutateAndAssert(
    key: readonly unknown[],
    expectedCount: number,
    opts?: { reject?: boolean; signupId?: number; status?: string },
) {
    const { invalidateSpy, wrapper } = createTestHarness();
    const status = opts?.status ?? 'attended';

    if (opts?.reject) {
        mockRecordAttendance.mockRejectedValue(new Error('network error'));
    } else {
        mockRecordAttendance.mockResolvedValue({ id: 1, attendanceStatus: status });
    }

    const { result } = renderHook(() => useRecordAttendance(EVENT_ID), { wrapper });

    await act(async () => {
        if (opts?.reject) {
            await result.current.mutate({ signupId: opts.signupId ?? 99, attendanceStatus: status });
        } else {
            await result.current.mutateAsync({ signupId: opts?.signupId ?? 10, attendanceStatus: status });
        }
    });

    const calls = getInvalidateCalls(invalidateSpy, [...key]);
    expect(calls).toHaveLength(expectedCount);
    return invalidateSpy;
}

// --- Tests ---

async function testInvalidatesMetrics() {
    await mutateAndAssert(METRICS_KEY, 1);
}

async function testInvalidatesAttendance() {
    await mutateAndAssert(ATTENDANCE_KEY, 1, { status: 'no_show', signupId: 5 });
}

async function testInvalidatesRoster() {
    await mutateAndAssert(ROSTER_KEY, 1, { status: 'excused', signupId: 7 });
}

async function testInvalidatesAllThreeKeys() {
    const spy = await mutateAndAssert(METRICS_KEY, 1, { signupId: 20 });
    expect(getInvalidateCalls(spy, [...ATTENDANCE_KEY])).toHaveLength(1);
    expect(getInvalidateCalls(spy, [...ROSTER_KEY])).toHaveLength(1);
}

async function testNoInvalidateOnFailure() {
    await mutateAndAssert(METRICS_KEY, 0, { reject: true });
}

async function testScopedToCorrectEventId() {
    const spy = await mutateAndAssert(METRICS_KEY, 1);
    const wrongKey = ['events', EVENT_ID + 1, 'metrics'] as const;
    expect(getInvalidateCalls(spy, [...wrongKey])).toHaveLength(0);
}

describe('useRecordAttendance — onSuccess cache invalidation (ROK-852)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('invalidates the metrics query key after recording attendance', testInvalidatesMetrics);
    it('invalidates the attendance query key after recording attendance', testInvalidatesAttendance);
    it('invalidates the roster query key after recording attendance', testInvalidatesRoster);
    it('invalidates all three query keys in a single mutation success', testInvalidatesAllThreeKeys);
    it('does not invalidate metrics when the mutation fails', testNoInvalidateOnFailure);
    it('scopes invalidation to the correct eventId, not other events', testScopedToCorrectEventId);
});
