/** ROK-1836 — the authorised blob object-URL hook (icons cannot use a bare `<img src>` on a bearer route). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

beforeEach(() => {
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
});
afterEach(() => { create.mockClear(); revoke.mockClear(); });

describe('useValheimBlobUrl', () => {
    it('fetches with the bearer token and yields an object URL, revoked on unmount', async () => {
        let auth: string | null = null;
        server.use(http.get(BLOB_URL, ({ request }) => {
            auth = request.headers.get('Authorization');
            return new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
        }));
        const { result, unmount } = renderHook(() => useValheimBlobUrl(7, SHA));
        await waitFor(() => expect(result.current).toBe('blob:atlas-1'));
        expect(auth).toBe('Bearer test-token');
        unmount();
        expect(revoke).toHaveBeenCalledWith('blob:atlas-1');
    });

    it('stays null when the blob is missing (caller falls back to the tile)', async () => {
        let hit = false;
        server.use(http.get(BLOB_URL, () => { hit = true; return new HttpResponse(null, { status: 404 }); }));
        const { result } = renderHook(() => useValheimBlobUrl(7, SHA));
        await waitFor(() => expect(hit).toBe(true));
        expect(result.current).toBeNull();
        expect(create).not.toHaveBeenCalled();
    });

    it('makes no request without a hash', () => {
        const { result } = renderHook(() => useValheimBlobUrl(7, null));
        expect(result.current).toBeNull();
    });
});
