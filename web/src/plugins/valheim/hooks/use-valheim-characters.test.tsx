/** ROK-1836 — the authorised blob object-URL hook (icons cannot use a bare `<img src>` on a bearer route). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../test/render-helpers';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { useValheimBlobUrl } from './use-valheim-characters';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const SHA = 'b'.repeat(64);
const BLOB_URL = `http://localhost:3000/plugins/valheim/armory/servers/7/blobs/${SHA}`;
const create = vi.fn(() => 'blob:atlas-1');
const revoke = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={createTestQueryClient()}>
            {children}
        </QueryClientProvider>
    );
}

beforeEach(() => {
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
});
afterEach(() => {
    create.mockClear();
    revoke.mockClear();
});

describe('useValheimBlobUrl', () => {
    it('fetches with the bearer token and yields an object URL, revoked on unmount', async () => {
        let auth: string | null = null;
        server.use(
            http.get(BLOB_URL, ({ request }) => {
                auth = request.headers.get('Authorization');
                return new HttpResponse(new Uint8Array([137, 80, 78, 71]), {
                    headers: { 'Content-Type': 'image/png' },
                });
            }),
        );
        const { result, unmount } = renderHook(
            () => useValheimBlobUrl(7, SHA),
            {
                wrapper,
            },
        );
        await waitFor(() => expect(result.current).toBe('blob:atlas-1'));
        expect(auth).toBe('Bearer test-token');
        unmount();
        expect(revoke).toHaveBeenCalledWith('blob:atlas-1');
    });

    it('stays null when the blob is missing (caller falls back to the tile)', async () => {
        let hit = false;
        server.use(
            http.get(BLOB_URL, () => {
                hit = true;
                return new HttpResponse(null, { status: 404 });
            }),
        );
        const { result } = renderHook(() => useValheimBlobUrl(7, SHA), {
            wrapper,
        });
        await waitFor(() => expect(hit).toBe(true));
        expect(result.current).toBeNull();
        expect(create).not.toHaveBeenCalled();
    });

    it('fetches a shared blob ONCE for several consumers on one page', async () => {
        let hits = 0;
        server.use(
            http.get(BLOB_URL, () => {
                hits += 1;
                return new HttpResponse(new Uint8Array([1]), {
                    headers: { 'Content-Type': 'image/png' },
                });
            }),
        );
        const client = createTestQueryClient();
        const shared = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>
                {children}
            </QueryClientProvider>
        );
        const a = renderHook(() => useValheimBlobUrl(7, SHA), {
            wrapper: shared,
        });
        const b = renderHook(() => useValheimBlobUrl(7, SHA), {
            wrapper: shared,
        });
        await waitFor(() => expect(a.result.current).toBe('blob:atlas-1'));
        await waitFor(() => expect(b.result.current).toBe('blob:atlas-1'));
        expect(hits).toBe(1);
    });

    it('makes no request without a hash', () => {
        const { result } = renderHook(() => useValheimBlobUrl(7, null), {
            wrapper,
        });
        expect(result.current).toBeNull();
    });
});
