/**
 * ROK-1700 — the Co-Optimus status route is a 404 under the cloud flavour, so
 * the status query must not fire there (no 404, no error state). Under nas it
 * fetches exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { createTestQueryClient } from '../../test/render-helpers';
import { useCooptimusSettings } from './use-cooptimus-settings';

vi.mock('../use-auth', () => ({ getAuthToken: vi.fn(() => 'test-token') }));

const API = 'http://localhost:3000';
let cooptimusHits = 0;

function setup(status: Record<string, unknown>) {
    server.use(
        http.get(`${API}/system/status`, () => HttpResponse.json(status)),
        http.get(`${API}/admin/settings/cooptimus`, () => {
            cooptimusHits += 1;
            return HttpResponse.json({ configured: true, proseEnabled: false });
        }),
    );
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, ...renderHook(() => useCooptimusSettings(), { wrapper }) };
}

describe('useCooptimusSettings under a runtime flavour (ROK-1700)', () => {
    beforeEach(() => { cooptimusHits = 0; });

    it('cloud: never requests the Co-Optimus status and holds no error', async () => {
        const { result, queryClient } = setup({ status: 'ok', flavour: 'cloud' });
        await waitFor(() => expect(queryClient.getQueryState(['system', 'status'])?.status).toBe('success'));
        expect(cooptimusHits).toBe(0);
        expect(result.current.cooptimusStatus.fetchStatus).toBe('idle');
        expect(result.current.cooptimusStatus.isError).toBe(false);
    });

    it('nas: fetches the status as before', async () => {
        const { result } = setup({ status: 'ok', flavour: 'nas' });
        await waitFor(() => expect(result.current.cooptimusStatus.data?.configured).toBe(true));
        expect(cooptimusHits).toBeGreaterThanOrEqual(1);
    });
});
