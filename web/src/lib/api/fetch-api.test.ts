import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';

import { server } from '../../test/mocks/server';
import { fetchApi, fetchWithAuth, SchemaValidationError } from './fetch-api';
import { ACCESS_TOKEN_KEY, AUTH_METHOD_KEY, ORIGINAL_TOKEN_KEY } from './auth-storage-keys';

const captureExceptionMock = vi.fn();

// Mutable stored access token so tests can exercise the ROK-1409 pre-flight
// staleness gate (fresh vs expired) against a controllable getAuthToken().
const authState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('../../sentry', () => ({
    Sentry: {
        captureException: (...args: unknown[]) => captureExceptionMock(...args),
    },
}));

vi.mock('../../hooks/use-auth', () => ({
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

/** Build a JWT whose exp is `offsetSeconds` from now. */
function tokenExpiringIn(offsetSeconds: number): string {
    const exp = Math.floor(Date.now() / 1000) + offsetSeconds;
    return `${base64url({ alg: 'HS256' })}.${base64url({ sub: 'u', exp })}.sig`;
}

const FRESH_TOKEN = tokenExpiringIn(3600);
const EXPIRED_TOKEN = tokenExpiringIn(-60);

const FixtureSchema = z.object({
    id: z.number(),
    status: z.enum(['signed_up', 'tentative', 'declined']),
});

describe('fetchApi — schema validation boundary (ROK-1237)', () => {
    beforeEach(() => {
        captureExceptionMock.mockClear();
    });

    it('returns parsed data on schema match', async () => {
        server.use(
            http.get(`${API_BASE}/fixture`, () =>
                HttpResponse.json({ id: 1, status: 'signed_up' }),
            ),
        );
        const result = await fetchApi('/fixture', {}, FixtureSchema);
        expect(result).toEqual({ id: 1, status: 'signed_up' });
        expect(captureExceptionMock).not.toHaveBeenCalled();
    });

    it('throws SchemaValidationError when the payload does not match', async () => {
        server.use(
            http.get(`${API_BASE}/fixture`, () =>
                HttpResponse.json({ id: 1, status: 'departed' }),
            ),
        );
        await expect(fetchApi('/fixture', {}, FixtureSchema)).rejects.toBeInstanceOf(
            SchemaValidationError,
        );
    });

    it('uses a stable user-facing message that does not include the issue array', async () => {
        server.use(
            http.get(`${API_BASE}/fixture`, () =>
                HttpResponse.json({ id: 'oops', status: 'gibberish' }),
            ),
        );
        let caught: Error | null = null;
        try {
            await fetchApi('/fixture', {}, FixtureSchema);
        } catch (err) {
            caught = err as Error;
        }
        expect(caught).toBeInstanceOf(SchemaValidationError);
        expect(caught?.message).toBe('We received an unexpected response from the server.');
        // The Zod issue codes/paths must NEVER be on the visible message.
        expect(caught?.message).not.toMatch(/invalid_enum_value/);
        expect(caught?.message).not.toMatch(/invalid_type/);
        expect(caught?.message).not.toMatch(/\[\s*\{/);
    });

    it('captures the raw issue array in Sentry extras, not on the message', async () => {
        server.use(
            http.get(`${API_BASE}/fixture`, () =>
                HttpResponse.json({ id: 1, status: 'departed' }),
            ),
        );
        await expect(fetchApi('/fixture', {}, FixtureSchema)).rejects.toBeInstanceOf(
            SchemaValidationError,
        );
        expect(captureExceptionMock).toHaveBeenCalledTimes(1);
        const [err, ctx] = captureExceptionMock.mock.calls[0];
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('Response schema validation failed');
        const extra = (ctx as { extra: { endpoint: string; issues: unknown[] } }).extra;
        expect(extra.endpoint).toBe('/fixture');
        expect(Array.isArray(extra.issues)).toBe(true);
        expect(extra.issues.length).toBeGreaterThan(0);
    });
});

describe('fetchWithAuth — ROK-1367 transparent on-401 refresh', () => {
    beforeEach(() => {
        localStorage.clear();
        // Prior-session marker gates the refresh probe (fetchWithAuth).
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        // A fresh token means the ROK-1409 pre-flight gate does NOT fire, so
        // these reactive-path assertions isolate the on-401 behaviour.
        authState.token = FRESH_TOKEN;
    });

    it('refreshes once and retries the request on a 401, then returns data', async () => {
        let dataCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'fresh-token' });
            }),
            http.get(`${API_BASE}/thing`, () => {
                dataCalls += 1;
                if (dataCalls === 1) return new HttpResponse(null, { status: 401 });
                return HttpResponse.json({ ok: true });
            }),
        );

        const result = await fetchApi<{ ok: boolean }>('/thing');

        expect(result).toEqual({ ok: true });
        expect(refreshCalls).toBe(1);
        expect(dataCalls).toBe(2);
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('fresh-token');
    });

    it('returns the raw 401 (no retry) when refresh itself fails', async () => {
        let dataCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return new HttpResponse(null, { status: 401 });
            }),
            http.get(`${API_BASE}/thing`, () => {
                dataCalls += 1;
                return new HttpResponse(null, { status: 401 });
            }),
        );

        const response = await fetchWithAuth('/thing');

        expect(response.status).toBe(401);
        // Refresh WAS attempted (once) but failed — so no retry fired.
        expect(refreshCalls).toBe(1);
        expect(dataCalls).toBe(1);
    });
});

describe('fetchWithAuth — ROK-1409 pre-flight staleness gate', () => {
    beforeEach(() => {
        localStorage.clear();
        authState.token = null;
    });

    it('refreshes ONCE up front for an expired token and sends the fresh token, zero 401 cycles', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        authState.token = EXPIRED_TOKEN;
        let dataCalls = 0;
        let refreshCalls = 0;
        let firstAuthHeader: string | null = null;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                // The pre-flight refresh must complete BEFORE the first data
                // request goes out.
                expect(dataCalls).toBe(0);
                authState.token = 'fresh-token';
                return HttpResponse.json({ access_token: 'fresh-token' });
            }),
            http.get(`${API_BASE}/thing`, ({ request }) => {
                dataCalls += 1;
                firstAuthHeader ??= request.headers.get('authorization');
                return HttpResponse.json({ ok: true });
            }),
        );

        const result = await fetchApi<{ ok: boolean }>('/thing');

        expect(result).toEqual({ ok: true });
        expect(refreshCalls).toBe(1);
        // No 401 → exactly one data request, carrying the freshly-minted token.
        expect(dataCalls).toBe(1);
        expect(firstAuthHeader).toBe('Bearer fresh-token');
    });

    it('does NOT pre-flight refresh for a still-fresh token', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        authState.token = FRESH_TOKEN;
        let dataCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'nope' });
            }),
            http.get(`${API_BASE}/thing`, () => {
                dataCalls += 1;
                return HttpResponse.json({ ok: true });
            }),
        );

        await fetchApi('/thing');

        expect(refreshCalls).toBe(0);
        expect(dataCalls).toBe(1);
    });

    it('does NOT refresh while impersonating (guard returns null), proceeds with the stored token', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        localStorage.setItem(ORIGINAL_TOKEN_KEY, 'admin-token');
        authState.token = EXPIRED_TOKEN;
        let dataCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'should-not-happen' });
            }),
            http.get(`${API_BASE}/thing`, ({ request }) => {
                dataCalls += 1;
                return HttpResponse.json({
                    header: request.headers.get('authorization'),
                });
            }),
        );

        const result = await fetchApi<{ header: string }>('/thing');

        // ensureFreshToken self-guards impersonation → no network refresh; the
        // request still went out on the (expired) impersonated bearer.
        expect(refreshCalls).toBe(0);
        expect(dataCalls).toBe(1);
        expect(result.header).toBe(`Bearer ${EXPIRED_TOKEN}`);
    });

    it('does NOT pre-flight for an anonymous visitor (no auth method) even with a stale token', async () => {
        // No AUTH_METHOD_KEY set.
        authState.token = EXPIRED_TOKEN;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'nope' });
            }),
            http.get(`${API_BASE}/thing`, () => HttpResponse.json({ ok: true })),
        );

        await fetchApi('/thing');

        expect(refreshCalls).toBe(0);
    });
});
