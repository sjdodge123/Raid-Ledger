import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/mocks/server';
import { adminFetch } from './admin-fetch';
import {
    ACCESS_TOKEN_KEY,
    AUTH_METHOD_KEY,
    ORIGINAL_TOKEN_KEY,
} from '../../lib/api/auth-storage-keys';

// Controllable stored access token for the ROK-1409 pre-flight gate.
const authState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('../use-auth', () => ({
    getAuthToken: () => authState.token,
}));

const API_BASE = 'http://localhost:3000';

/** Encode an object as a base64url JWT segment (no padding). */
function base64url(obj: Record<string, unknown>): string {
    return btoa(JSON.stringify(obj))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function tokenExpiringIn(offsetSeconds: number): string {
    const exp = Math.floor(Date.now() / 1000) + offsetSeconds;
    return `${base64url({ alg: 'HS256' })}.${base64url({ sub: 'u', exp })}.sig`;
}

const FRESH_TOKEN = tokenExpiringIn(3600);
const EXPIRED_TOKEN = tokenExpiringIn(-60);

describe('adminFetch — ROK-1409 pre-flight + reactive backstop', () => {
    beforeEach(() => {
        localStorage.clear();
        authState.token = null;
    });

    it('refreshes ONCE up front for an expired token, no 401 cycle', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        authState.token = EXPIRED_TOKEN;
        let dataCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                expect(dataCalls).toBe(0);
                authState.token = 'fresh-token';
                return HttpResponse.json({ access_token: 'fresh-token' });
            }),
            http.get(`${API_BASE}/admin/thing`, ({ request }) => {
                dataCalls += 1;
                return HttpResponse.json({
                    header: request.headers.get('authorization'),
                });
            }),
        );

        const result = await adminFetch<{ header: string }>('/admin/thing');

        expect(refreshCalls).toBe(1);
        expect(dataCalls).toBe(1);
        expect(result.header).toBe('Bearer fresh-token');
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('fresh-token');
    });

    it('does NOT pre-flight for a fresh token', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        authState.token = FRESH_TOKEN;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'nope' });
            }),
            http.get(`${API_BASE}/admin/thing`, () => HttpResponse.json({ ok: true })),
        );

        await adminFetch('/admin/thing');

        expect(refreshCalls).toBe(0);
    });

    it('keeps the reactive 401 → refresh → retry backstop for a fresh token that the server rejects', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        authState.token = FRESH_TOKEN;
        let dataCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'fresh-token' });
            }),
            http.get(`${API_BASE}/admin/thing`, () => {
                dataCalls += 1;
                if (dataCalls === 1) return new HttpResponse(null, { status: 401 });
                return HttpResponse.json({ ok: true });
            }),
        );

        const result = await adminFetch<{ ok: boolean }>('/admin/thing');

        expect(result).toEqual({ ok: true });
        expect(refreshCalls).toBe(1);
        expect(dataCalls).toBe(2);
    });

    it('does NOT pre-flight while impersonating; proceeds on the stored token', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        localStorage.setItem(ORIGINAL_TOKEN_KEY, 'admin-token');
        authState.token = EXPIRED_TOKEN;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'nope' });
            }),
            http.get(`${API_BASE}/admin/thing`, ({ request }) =>
                HttpResponse.json({ header: request.headers.get('authorization') }),
            ),
        );

        const result = await adminFetch<{ header: string }>('/admin/thing');

        expect(refreshCalls).toBe(0);
        expect(result.header).toBe(`Bearer ${EXPIRED_TOKEN}`);
    });
});
