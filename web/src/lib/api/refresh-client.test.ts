import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/mocks/server';
import { ensureFreshToken, refreshWithOutcome } from './refresh-client';
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

/**
 * ROK-1366 #1384: the magic-link redeem needs to tell a dead session (401/403)
 * apart from a refresh that proves nothing (429, 5xx, network, bad body).
 */
describe('refreshWithOutcome (ROK-1366 #1384 tri-state refresh)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    function refreshAnswers(status: number): void {
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => new HttpResponse(null, { status })),
        );
    }

    it('reports ok with the token and stores it on a 200', async () => {
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.json({ access_token: 'fresh' })),
        );

        expect(await refreshWithOutcome()).toEqual({ kind: 'ok', token: 'fresh' });
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('fresh');
    });

    it.each([401, 403])('reports rejected on a %i', async (status) => {
        refreshAnswers(status);

        expect(await refreshWithOutcome()).toEqual({ kind: 'rejected' });
    });

    it.each([429, 500, 502, 503, 404])('reports indeterminate on a %i', async (status) => {
        refreshAnswers(status);

        expect(await refreshWithOutcome()).toEqual({ kind: 'indeterminate' });
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    });

    it('reports indeterminate on a network error', async () => {
        server.use(http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.error()));

        expect(await refreshWithOutcome()).toEqual({ kind: 'indeterminate' });
    });

    it('reports indeterminate on a 200 whose body is not a token', async () => {
        server.use(http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.json({ nope: true })));

        expect(await refreshWithOutcome()).toEqual({ kind: 'indeterminate' });
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    });

    it('shares the single in-flight refresh with ensureFreshToken', async () => {
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'shared' });
            }),
        );

        const [outcome, token] = await Promise.all([refreshWithOutcome(), ensureFreshToken()]);

        expect(refreshCalls).toBe(1);
        expect(outcome).toEqual({ kind: 'ok', token: 'shared' });
        expect(token).toBe('shared');
    });

    it('ensureFreshToken still returns null on an indeterminate refresh', async () => {
        refreshAnswers(429);

        expect(await ensureFreshToken()).toBeNull();
    });
});

describe('refreshWithOutcome while impersonating (ROK-1366 #1384)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('reports indeterminate and never hits the network while impersonating', async () => {
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'should-not-happen' });
            }),
        );
        localStorage.setItem(ORIGINAL_TOKEN_KEY, 'admin-token');

        expect(await refreshWithOutcome()).toEqual({ kind: 'indeterminate' });
        expect(refreshCalls).toBe(0);
    });
});
