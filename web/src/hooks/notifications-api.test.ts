/**
 * ROK-1845 — markNotificationRead puts the id into a Bearer-authenticated POST
 * path. A hostile id must not move the request off /notifications/:id/read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/config', () => ({ API_BASE_URL: 'http://api.test/api' }));
vi.mock('./use-auth', () => ({ getAuthToken: () => 'test-token' }));
vi.mock('../lib/api/native-fetch', () => ({ nativeFetch: vi.fn() }));

import { nativeFetch } from '../lib/api/native-fetch';
import { markNotificationRead } from './notifications-api';

const mockFetch = vi.mocked(nativeFetch);

function calledPath(): string {
    const target = mockFetch.mock.calls[0]?.[0];
    if (typeof target !== 'string') throw new Error('nativeFetch was not called with a URL string');
    return new URL(target).pathname;
}

describe('markNotificationRead (ROK-1845)', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    });

    it('keeps a hostile id inside /notifications/<encoded>/read', async () => {
        await markNotificationRead('../admin/settings/oauth/clear#');
        expect(calledPath()).toBe('/api/notifications/..%2Fadmin%2Fsettings%2Foauth%2Fclear%23/read');
        expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    });

    it('rejects a bare ".." id without sending anything', async () => {
        await expect(markNotificationRead('..')).rejects.toThrow(/path segment/i);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('posts a UUID id to its read route unchanged', async () => {
        const id = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
        await markNotificationRead(id);
        expect(calledPath()).toBe(`/api/notifications/${id}/read`);
    });
});
