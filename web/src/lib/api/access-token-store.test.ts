import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/mocks/server';
import { AUTH_METHOD_KEY, LEGACY_ACCESS_TOKEN_KEY, LEGACY_ORIGINAL_TOKEN_KEY } from './auth-storage-keys';

/** ROK-1754 AC1: the access token lives in memory only. */

const API_BASE = 'http://localhost:3000';

function jwtWith(claims: object): string {
    const seg = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${seg({ alg: 'HS256' })}.${seg(claims)}.sig`;
}

const LOGIN = jwtWith({ sub: 1, exp: 4102444800, n: 'login' });
const REFRESHED = jwtWith({ sub: 1, exp: 4102444800, n: 'refresh' });
const MAGIC = jwtWith({ sub: 1, exp: 4102444800, n: 'magic' });
const IMPERSONATED = jwtWith({ sub: 7, impersonatedBy: 1, exp: 4102444800 });
const TOKENS = [LOGIN, REFRESHED, MAGIC, IMPERSONATED];

/** Every value written to either Storage, across the whole test. */
function spyStorageWrites(): () => string[] {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    return () => spy.mock.calls.map(([key, value]) => `${String(key)}=${String(value)}`);
}

function wrapper(client: QueryClient) {
    return ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
}

describe('access-token-store (ROK-1754)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('holds, replaces, clears and notifies subscribers', async () => {
        const store = await import('./access-token-store');
        const seen = vi.fn();
        const off = store.subscribeAccessToken(seen);
        store.setAccessToken('a');
        store.setAccessToken('a');
        store.clearAccessToken();
        off();
        store.setAccessToken('b');
        expect(seen).toHaveBeenCalledTimes(2);
        expect(store.getAccessToken()).toBe('b');
    });

    it('reads "impersonating" from the impersonatedBy claim of the held token', async () => {
        const store = await import('./access-token-store');
        store.setAccessToken(LOGIN);
        expect(store.isImpersonatingToken()).toBe(false);
        store.setAccessToken(IMPERSONATED);
        expect(store.isImpersonatingToken()).toBe(true);
        expect(store.isImpersonatingToken('not-a-jwt')).toBe(false);
    });

    it('purges the legacy stored tokens at module load and reports it', async () => {
        localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, LOGIN);
        localStorage.setItem(LEGACY_ORIGINAL_TOKEN_KEY, 'admin-jwt');
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        vi.resetModules();
        const store = await import('./access-token-store');

        expect(localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY)).toBeNull();
        expect(localStorage.getItem(LEGACY_ORIGINAL_TOKEN_KEY)).toBeNull();
        expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('local');
        expect(store.legacySessionPurged()).toBe(true);
        expect(store.getAccessToken()).toBeNull();
    });

    it('reports no legacy session when nothing was stored', async () => {
        vi.resetModules();
        const store = await import('./access-token-store');
        expect(store.legacySessionPurged()).toBe(false);
    });

    it('AC1: login, refresh, magic-link redeem and impersonate never write a token to storage', async () => {
        server.use(
            http.get(`${API_BASE}/auth/me`, () => HttpResponse.json({ id: 1, username: 'u' })),
            http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.json({ access_token: REFRESHED })),
            http.post(`${API_BASE}/auth/redeem-magic-link`, () => HttpResponse.json({ access_token: MAGIC })),
            http.post(`${API_BASE}/auth/impersonate/7`, () => HttpResponse.json({ access_token: IMPERSONATED })),
        );
        const writes = spyStorageWrites();
        const { useAuth } = await import('../../hooks/use-auth');
        const { refreshWithOutcome } = await import('./refresh-client');
        const { startMagicLinkRedeem } = await import('../magic-link-redeem');
        const store = await import('./access-token-store');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result } = renderHook(() => useAuth(), { wrapper: wrapper(client) });

        await act(async () => { await result.current.login(LOGIN); });
        expect(store.getAccessToken()).toBe(LOGIN);
        expect(await refreshWithOutcome()).toEqual({ kind: 'ok', token: REFRESHED });
        store.clearAccessToken();
        localStorage.clear();
        await startMagicLinkRedeem('magic.link.raw');
        expect(store.getAccessToken()).toBe(MAGIC);
        await act(async () => { await result.current.impersonate(7); });
        expect(store.getAccessToken()).toBe(IMPERSONATED);

        const leaked = writes().filter((w) => TOKENS.some((t) => w.includes(t)));
        expect(leaked).toEqual([]);
        expect(writes().length).toBeGreaterThan(0); // the spy saw the marker/cache writes
    });
});
