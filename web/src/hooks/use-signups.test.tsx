import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCancelSignup, useSignup, useUpdateSignupStatus } from './use-signups';

const api = vi.hoisted(() => ({ cancelSignup: vi.fn(), signupForEvent: vi.fn(), confirmSignup: vi.fn(), updateSignupStatus: vi.fn() }));
vi.mock('../lib/api-client', () => api);

describe('use-signups series invalidation (ROK-1728)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('a one-night cancel (Skip this night) invalidates every night\'s series state, not just this one', async () => {
        api.cancelSignup.mockResolvedValue(undefined);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
        const { result } = renderHook(() => useCancelSignup(10), { wrapper });
        result.current.mutate();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
        expect(keys).toContain(JSON.stringify(['series-signup']));
    });
});

describe('use-signups refresh the event Discussion card + panel (ROK-2226)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    function setup() {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        // A cached card summary (per viewer) and panel thread for event 10.
        queryClient.setQueryData(['events', 10, 'discussion', 'u1'], { state: 'none' });
        queryClient.setQueryData(['events', 10, 'discussion', 'thread', 'u1'], { pages: [] });
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
        const stale = (key: unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
        return { queryClient, wrapper, stale };
    }

    it('signing up invalidates the card summary and the ?discussion=1 thread', async () => {
        api.signupForEvent.mockResolvedValue({ id: 1 });
        const { wrapper, stale } = setup();
        const { result } = renderHook(() => useSignup(10), { wrapper });
        result.current.mutate(undefined);
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(stale(['events', 10, 'discussion', 'u1'])).toBe(true);
        expect(stale(['events', 10, 'discussion', 'thread', 'u1'])).toBe(true);
    });

    it('withdrawing invalidates the card summary', async () => {
        api.cancelSignup.mockResolvedValue(undefined);
        const { wrapper, stale } = setup();
        const { result } = renderHook(() => useCancelSignup(10), { wrapper });
        result.current.mutate();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(stale(['events', 10, 'discussion', 'u1'])).toBe(true);
    });

    it('declining (status change) invalidates the card summary and thread', async () => {
        api.updateSignupStatus.mockResolvedValue({ id: 1 });
        const { wrapper, stale } = setup();
        const { result } = renderHook(() => useUpdateSignupStatus(10), { wrapper });
        result.current.mutate('declined');
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(stale(['events', 10, 'discussion', 'u1'])).toBe(true);
        expect(stale(['events', 10, 'discussion', 'thread', 'u1'])).toBe(true);
    });
});
