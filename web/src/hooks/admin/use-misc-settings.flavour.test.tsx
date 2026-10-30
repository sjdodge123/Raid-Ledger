/**
 * ROK-1700 — the Demo Data status route is a 404 under the cloud flavour, so
 * `useMiscSettings()` (spread into every `useAdminSettings()` caller) must not
 * fire it there — no 404, no retries, no error state. Under nas it fetches
 * exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { createTestQueryClient } from '../../test/render-helpers';
import { useMiscSettings } from './use-misc-settings';
import { useSettledFlavour } from '../use-flavour';

vi.mock('../use-auth', () => ({ getAuthToken: vi.fn(() => 'test-token') }));

const API = 'http://localhost:3000';
let demoHits = 0;

function setup(status: Record<string, unknown>) {
    server.use(
        http.get(`${API}/system/status`, () => HttpResponse.json(status)),
        http.get(`${API}/admin/settings/demo/status`, () => {
            demoHits += 1;
            return HttpResponse.json({ demoMode: false, users: 0, events: 0 });
        }),
    );
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    // The flavour hook rides alongside so `/system/status` always settles —
    // the assertion is about the demo request, not about the status fetch.
    const hook = renderHook(() => ({ misc: useMiscSettings(), flavour: useSettledFlavour() }), { wrapper });
    return { queryClient, ...hook };
}

describe('useMiscSettings demo-status under a runtime flavour (ROK-1700)', () => {
    beforeEach(() => { demoHits = 0; });

    it('cloud: never requests the demo-data status and holds no error', async () => {
        const { result, queryClient } = setup({ status: 'ok', flavour: 'cloud' });
        await waitFor(() => expect(result.current.flavour).toBe('cloud'));
        expect(queryClient.getQueryState(['system', 'status'])?.status).toBe('success');
        expect(demoHits).toBe(0);
        expect(result.current.misc.demoDataStatus.fetchStatus).toBe('idle');
        expect(result.current.misc.demoDataStatus.isError).toBe(false);
    });

    it('nas: fetches the demo-data status as before', async () => {
        const { result } = setup({ status: 'ok', flavour: 'nas' });
        await waitFor(() => expect(result.current.misc.demoDataStatus.isSuccess).toBe(true));
        expect(demoHits).toBeGreaterThanOrEqual(1);
    });
});
