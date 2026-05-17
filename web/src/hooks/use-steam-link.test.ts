/**
 * Tests for use-steam-link mutations (ROK-1307).
 *
 * AC-2b — unlinkSteam.onSuccess writes `{ linked: false }` into the
 *         ['steam','status'] cache BEFORE the subsequent invalidate, so the
 *         next render of <SteamSection /> drops out of the linked panel
 *         and the silent-fail "ghost linked state" trap can't happen.
 *
 * AC-8  — sync mutations invalidate ['steam','status'] on BOTH success AND
 *         error paths, so a 400 (now produced by AC-1/AC-7) triggers a
 *         refetch instead of stranding stale cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('./use-auth', () => ({
    getAuthToken: () => 'test-jwt',
}));

vi.mock('../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import { useUnlinkSteam, useSyncLibrary, useSyncWishlist } from './use-steam-link';

const STATUS_KEY = ['steam', 'status'];

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
            mutations: { retry: false },
        },
    });
    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }
    return { queryClient, wrapper };
}

describe('useUnlinkSteam (ROK-1307 AC-2b)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('setQueryData(["steam","status"], { linked: false }) runs BEFORE invalidateQueries on the same key', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) }),
        );
        const { wrapper, queryClient } = createWrapper();

        // Seed the cache with the pre-unlink linked state.
        queryClient.setQueryData(STATUS_KEY, { linked: true, personaName: 'Roknua' });

        const setSpy = vi.spyOn(queryClient, 'setQueryData');
        const invalSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useUnlinkSteam(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync();
        });

        // The optimistic set must have happened.
        const optimisticCall = setSpy.mock.calls.find(
            ([key]) => JSON.stringify(key) === JSON.stringify(STATUS_KEY),
        );
        expect(optimisticCall).toBeDefined();
        expect(optimisticCall![1]).toEqual({ linked: false });

        // And it must have happened BEFORE the first invalidate for the same key.
        const setOrder = setSpy.mock.invocationCallOrder[
            setSpy.mock.calls.findIndex(
                ([key]) => JSON.stringify(key) === JSON.stringify(STATUS_KEY),
            )
        ];
        const firstInvalIdx = invalSpy.mock.calls.findIndex(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify(STATUS_KEY),
        );
        expect(firstInvalIdx).toBeGreaterThanOrEqual(0);
        const invalOrder = invalSpy.mock.invocationCallOrder[firstInvalIdx];
        expect(setOrder).toBeLessThan(invalOrder);

        // And the cache currently holds { linked: false } so the next render
        // of consumers (SteamSection) drops out of the linked panel.
        expect(queryClient.getQueryData(STATUS_KEY)).toEqual({ linked: false });
    });

    it('does NOT clear cache when unlink fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }),
        );
        const { wrapper, queryClient } = createWrapper();
        queryClient.setQueryData(STATUS_KEY, { linked: true, personaName: 'Roknua' });

        const { result } = renderHook(() => useUnlinkSteam(), { wrapper });

        await act(async () => {
            try {
                await result.current.mutateAsync();
            } catch {
                // expected
            }
        });

        // Pre-unlink linked state remains — operator-visible state must NOT
        // get blown away on failed unlink.
        expect(queryClient.getQueryData(STATUS_KEY)).toMatchObject({
            linked: true,
        });
    });
});

describe('useSyncLibrary onError (ROK-1307 AC-8)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('invalidates ["steam","status"] on mutation error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: async () => ({ message: 'Steam account not linked' }),
            }),
        );
        const { wrapper, queryClient } = createWrapper();
        const invalSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useSyncLibrary(), { wrapper });

        await act(async () => {
            try {
                await result.current.mutateAsync();
            } catch {
                // expected
            }
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const statusInvalidations = invalSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify(STATUS_KEY),
        );
        expect(statusInvalidations.length).toBeGreaterThanOrEqual(1);
    });
});

describe('useSyncWishlist onError (ROK-1307 AC-8)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('invalidates ["steam","status"] on mutation error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: async () => ({ message: 'Steam profile is private — …' }),
            }),
        );
        const { wrapper, queryClient } = createWrapper();
        const invalSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useSyncWishlist(), { wrapper });

        await act(async () => {
            try {
                await result.current.mutateAsync();
            } catch {
                // expected
            }
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const statusInvalidations = invalSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify(STATUS_KEY),
        );
        expect(statusInvalidations.length).toBeGreaterThanOrEqual(1);
    });
});
