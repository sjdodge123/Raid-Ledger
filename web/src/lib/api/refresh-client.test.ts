import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/mocks/server';
import { ensureFreshToken } from './refresh-client';
import { ACCESS_TOKEN_KEY, ORIGINAL_TOKEN_KEY } from './auth-storage-keys';

const API_BASE = 'http://localhost:3000';

describe('ensureFreshToken (ROK-1353 single-flight, ROK-1409 pre-flight caller)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('shares ONE in-flight refresh across concurrent callers', async () => {
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, async () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'fresh-token' });
            }),
        );

        const [a, b, c] = await Promise.all([
            ensureFreshToken(),
            ensureFreshToken(),
            ensureFreshToken(),
        ]);

        expect(refreshCalls).toBe(1);
        expect(a).toBe('fresh-token');
        expect(b).toBe('fresh-token');
        expect(c).toBe('fresh-token');
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('fresh-token');
    });

    it('starts a new in-flight refresh once the previous one settles', async () => {
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: `tok-${refreshCalls}` });
            }),
        );

        await ensureFreshToken();
        await ensureFreshToken();

        expect(refreshCalls).toBe(2);
    });

    it('returns null and never hits the network while impersonating', async () => {
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'should-not-happen' });
            }),
        );
        localStorage.setItem(ORIGINAL_TOKEN_KEY, 'admin-token');

        const result = await ensureFreshToken();

        expect(result).toBeNull();
        expect(refreshCalls).toBe(0);
    });

    it('returns null when the refresh endpoint rejects', async () => {
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
        );

        expect(await ensureFreshToken()).toBeNull();
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    });
});
