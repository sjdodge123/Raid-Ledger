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

import { useUnlinkSteam, useSyncLibrary, useSyncWishlist, useSteamLink } from './use-steam-link';
import { API_BASE_URL } from '../lib/config';
import { toast } from '../lib/toast';

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

describe('useSteamLink().linkSteam (ROK-1630 AC16)', () => {
    const realLocation = window.location;
    let navigations: string[] = [];

    function stubStart(status: number, body: unknown) {
        const fn = vi.fn(async (url: string) =>
            url.endsWith('/auth/steam/link/start')
                ? { ok: status >= 200 && status < 300, status, json: async () => body }
                : { ok: true, status: 200, json: async () => ({ linked: false }) },
        );
        vi.stubGlobal('fetch', fn);
        return fn;
    }

    function startCall(fn: ReturnType<typeof stubStart>) {
        return fn.mock.calls.find(([u]) => String(u).endsWith('/auth/steam/link/start')) as
            [string, RequestInit & { headers: Record<string, string> }] | undefined;
    }

    beforeEach(() => {
        navigations = [];
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: {
                get href() { return 'http://localhost/onboarding'; },
                set href(v: string) { navigations.push(v); },
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('POSTs start with {returnTo} and the Bearer header, then navigates to the ?nonce= hop', async () => {
        const fetchFn = stubStart(200, { nonce: 'st/eam', expiresIn: 120 });
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useSteamLink(), { wrapper });
        await act(async () => { await result.current.linkSteam('/onboarding'); });

        const call = startCall(fetchFn);
        expect(call, 'expected a POST to /auth/steam/link/start').toBeDefined();
        expect(call![1].method).toBe('POST');
        expect(call![1].headers.Authorization).toBe('Bearer test-jwt');
        expect(JSON.parse(String(call![1].body))).toEqual({ returnTo: '/onboarding' });
        expect(navigations).toEqual([`${API_BASE_URL}/auth/steam/link?nonce=${encodeURIComponent('st/eam')}`]);
    });

    it('a 401 from start shows the Steam log-in-again toast and does not navigate', async () => {
        stubStart(401, { message: 'Unauthorized' });
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useSteamLink(), { wrapper });
        await act(async () => { await result.current.linkSteam(); });

        expect(toast.error).toHaveBeenCalledWith('Please log in again to link Steam');
        expect(navigations).toEqual([]);
        expect(result.current.isLinkPending).toBe(false);
    });

    it('a click event passed as the argument is not sent as returnTo', async () => {
        const fetchFn = stubStart(200, { nonce: 'n', expiresIn: 120 });
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useSteamLink(), { wrapper });
        const fakeEvent = { type: 'click' } as unknown as string;
        await act(async () => { await result.current.linkSteam(fakeEvent); });

        expect(JSON.parse(String(startCall(fetchFn)![1].body))).toEqual({});
    });
});
