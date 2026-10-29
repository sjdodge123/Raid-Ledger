/**
 * ROK-1955 Codex P2 — the Devices card must not hide a just-linked device:
 * an approve invalidates the list, and the list refetches on every mount.
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { createTestQueryClient } from '../../test/render-helpers';
import { COMPANION_DEVICES_KEY, useCompanionDevices } from '../use-companion-devices';
import { useCompanionLinkDecision } from '../use-companion-link';

const API = 'http://localhost:3000';

function wrapperFor(client: QueryClient) {
    return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

function invalidatedKeys(spy: MockInstance<QueryClient['invalidateQueries']>): unknown[] {
    return spy.mock.calls.map((call) => call[0]?.queryKey);
}

afterEach(() => { server.resetHandlers(); });

describe('Companion devices list freshness (Codex P2)', () => {
    it.each(['approved', 'denied'] as const)('a %s decision invalidates the devices list only when approved', async (status) => {
        server.use(http.post(`${API}/companion/v1/devices/link/decision`, () => HttpResponse.json({ status })));
        const client = createTestQueryClient();
        const spy = vi.spyOn(client, 'invalidateQueries');
        const { result } = renderHook(() => useCompanionLinkDecision(), { wrapper: wrapperFor(client) });
        await act(async () => {
            await result.current.mutateAsync({ userCode: 'BCDFGHJK', decision: status === 'approved' ? 'approve' : 'deny' });
        });
        const expected = status === 'approved' ? [COMPANION_DEVICES_KEY] : [];
        expect(invalidatedKeys(spy)).toEqual(expected);
    });

    it('refetches the list on mount even when the cached copy is still fresh', async () => {
        let hits = 0;
        server.use(http.get(`${API}/companion/v1/devices`, () => { hits += 1; return HttpResponse.json({ data: [] }); }));
        const client = createTestQueryClient();
        client.setDefaultOptions({ queries: { staleTime: 5 * 60_000, retry: false } });
        client.setQueryData(COMPANION_DEVICES_KEY, []);
        renderHook(() => useCompanionDevices(), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(hits).toBe(1));
    });
});
