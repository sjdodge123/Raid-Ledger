/**
 * ROK-2033 — `useReopenLockIn`. 200 toasts "Poll reopened" and refetches the
 * poll so it shows `scheduling`; 409 (nothing to reopen / the in-flight
 * lock-in finished first) shows the API's own message as a NEUTRAL toast, not
 * an error, and still refetches; any other failure is an error toast.
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { createTestQueryClient } from '../../test/render-helpers';
import { withHttpStatus } from '../../lib/api/api-error';
import { useReopenLockIn } from '../use-scheduling';

const reopenLockInMock = vi.fn();
vi.mock('../../lib/api-client', () => ({
    reopenLockIn: (...args: unknown[]) => reopenLockInMock(...args),
}));

const toastMocks = vi.hoisted(() => ({
    neutral: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}));
vi.mock('../../lib/toast', () => ({
    toast: Object.assign(toastMocks.neutral, {
        success: toastMocks.success,
        error: toastMocks.error,
    }),
}));

const NOTHING_TO_REOPEN = 'This poll has no unfinished lock-in to reopen';

function setup() {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }
    const { result } = renderHook(() => useReopenLockIn(), { wrapper });
    return { result, invalidateSpy };
}

/** True when an invalidate targeted the scheduling poll prefix (`['scheduling']`). */
function invalidatedPoll(spy: MockInstance<QueryClient['invalidateQueries']>): boolean {
    return spy.mock.calls.some((call) => {
        const key = (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
        return Array.isArray(key) && key[0] === 'scheduling';
    });
}

async function run(result: ReturnType<typeof setup>['result']) {
    await act(async () => {
        result.current.mutate({ matchId: 9 });
    });
    await waitFor(() => expect(result.current.isIdle).toBe(false));
    await waitFor(() => expect(result.current.isPending).toBe(false));
}

describe('useReopenLockIn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('200: posts for the match, toasts "Poll reopened" and refetches the poll', async () => {
        reopenLockInMock.mockResolvedValue({
            matchId: 9,
            status: 'scheduling',
            discardedEventIds: [41],
        });
        const { result, invalidateSpy } = setup();
        await run(result);
        expect(reopenLockInMock).toHaveBeenCalledWith(9);
        expect(toastMocks.success).toHaveBeenCalledWith('Poll reopened');
        expect(invalidatedPoll(invalidateSpy)).toBe(true);
    });

    it('409: shows the API message as a neutral toast and still refetches', async () => {
        reopenLockInMock.mockRejectedValue(
            withHttpStatus(new Error(NOTHING_TO_REOPEN), 409),
        );
        const { result, invalidateSpy } = setup();
        await run(result);
        expect(toastMocks.neutral).toHaveBeenCalledWith(NOTHING_TO_REOPEN);
        expect(toastMocks.error).not.toHaveBeenCalled();
        expect(invalidatedPoll(invalidateSpy)).toBe(true);
    });

    it('other failures: an error toast with the message', async () => {
        reopenLockInMock.mockRejectedValue(
            withHttpStatus(new Error('Server exploded'), 500),
        );
        const { result } = setup();
        await run(result);
        expect(toastMocks.error).toHaveBeenCalledWith('Server exploded');
        expect(toastMocks.neutral).not.toHaveBeenCalled();
    });
});
