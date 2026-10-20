/**
 * ROK-1428 web review — cache coherence between the bindings list and the
 * lifecycle preview (both directions), scoped lifecycle invalidation, and the
 * preview's `staleTime: 0` override of the global 5-minute default.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { createTestQueryClient } from '../../test/render-helpers';
import { useChannelBindings } from '../use-channel-bindings';
import { LIFECYCLE_ACTIVITY_KEY, useLifecycleActivity, useReconcile } from './use-channel-lifecycle';

const BINDINGS_KEY = ['admin', 'discord', 'bindings'];

function setup(): { qc: ReturnType<typeof createTestQueryClient>; spy: ReturnType<typeof vi.spyOn>; wrapper: (p: { children: ReactNode }) => ReactNode } {
    const qc = createTestQueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return { qc, spy, wrapper };
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>): unknown[] {
    return spy.mock.calls.map((c: unknown[]) => {
        const arg: unknown = c[0];
        return typeof arg === 'object' && arg !== null && 'queryKey' in arg ? arg.queryKey : undefined;
    });
}

describe('lifecycle ↔ bindings cache (ROK-1428 review)', () => {
    it('a bindings-page PATCH (pin) invalidates the lifecycle preview', async () => {
        server.use(http.patch('http://localhost:3000/admin/discord/bindings/:id', () => HttpResponse.json({ data: {} })));
        const { spy, wrapper } = setup();
        const { result } = renderHook(() => useChannelBindings(), { wrapper });
        result.current.updateBinding.mutate({ id: 'b1', dto: { pinned: true } });
        await waitFor(() => expect(invalidatedKeys(spy)).toEqual(expect.arrayContaining([BINDINGS_KEY, [...LIFECYCLE_ACTIVITY_KEY]])));
    });

    it('a real reconcile invalidates the bindings list; a dry run invalidates nothing', async () => {
        const { spy, wrapper } = setup();
        const { result } = renderHook(() => useReconcile(), { wrapper });
        await result.current.mutateAsync(true);
        expect(spy).not.toHaveBeenCalled();
        await result.current.mutateAsync(false);
        const keys = invalidatedKeys(spy);
        expect(keys).toEqual(expect.arrayContaining([BINDINGS_KEY, [...LIFECYCLE_ACTIVITY_KEY]]));
        expect(keys).not.toContainEqual(['admin', 'discord', 'lifecycle', 'bot']);
        expect(keys).not.toContainEqual(['admin', 'discord', 'lifecycle', 'categories']);
    });

    it('the activity preview opts out of the global staleTime', async () => {
        const { qc, wrapper } = setup();
        qc.setDefaultOptions({ queries: { retry: false, staleTime: 300_000 } });
        const { result } = renderHook(() => useLifecycleActivity(), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.isStale).toBe(true);
    });
});
