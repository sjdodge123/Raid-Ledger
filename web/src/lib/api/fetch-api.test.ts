import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';

import { server } from '../../test/mocks/server';
import { fetchApi, fetchWithAuth, SchemaValidationError } from './fetch-api';
import { ACCESS_TOKEN_KEY, AUTH_METHOD_KEY } from './auth-storage-keys';

const captureExceptionMock = vi.fn();

vi.mock('../../sentry', () => ({
    Sentry: {
        captureException: (...args: unknown[]) => captureExceptionMock(...args),
    },
}));

vi.mock('../../hooks/use-auth', () => ({
    getAuthToken: () => null,
}));

const API_BASE = 'http://localhost:3000';

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
