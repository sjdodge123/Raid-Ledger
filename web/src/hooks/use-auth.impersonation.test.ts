import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { API_BASE_URL } from '../lib/config';
import { useAuth } from './use-auth';
import { getAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { ensureFreshToken } from '../lib/api/refresh-client';
import { toast } from '../lib/toast';
import { IDENTITY_EPOCH_KEY } from '../lib/api/cross-tab-auth';

vi.mock('../lib/toast', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

function jwtWith(claims: object): string {
    const seg = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(claims)}.sig`;
}
const exp = Math.floor(Date.now() / 1000) + 3600;
const ADMIN = jwtWith({ sub: 1, username: 'admin', role: 'admin', exp });
const IMP = jwtWith({ sub: 7, username: 'target', role: 'member', impersonatedBy: 1, exp });

function storageValues(): string[] {
    return [...Object.values({ ...localStorage }), ...Object.values({ ...sessionStorage })].map(String);
}

function renderAuth(seedUser?: object) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (seedUser) queryClient.setQueryData(['auth', 'me'], seedUser);
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return renderHook(() => useAuth(), { wrapper });
}

/** Records the order of auth POSTs; `exit` may be overridden per test. */
function serveAuth(calls: string[], exit?: () => Response) {
    server.use(
        http.post(`${API_BASE_URL}/auth/impersonate/exit`, () => {
            calls.push('exit');
            return exit ? exit() : HttpResponse.json({ success: true });
        }),
        http.post(`${API_BASE_URL}/auth/refresh`, () => {
            calls.push('refresh');
            return HttpResponse.json({ access_token: ADMIN });
        }),
        http.post(`${API_BASE_URL}/auth/impersonate/7`, () => {
            calls.push('start');
            return HttpResponse.json({ access_token: IMP, user: { id: 7, username: 'target', avatar: null, role: 'member' } });
        }),
        http.get(`${API_BASE_URL}/auth/me`, () => HttpResponse.json({ id: 1, username: 'admin' })),
    );
}

describe('ROK-1754 C: impersonation is server-side, the token memory-only', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.mocked(toast.info).mockClear();
        vi.mocked(toast.error).mockClear();
    });

    it('start holds the impersonation token in memory and writes it to no storage', async () => {
        const calls: string[] = [];
        serveAuth(calls);
        setAccessToken(ADMIN);
        const { result } = renderAuth();
        let ok = false;
        await act(async () => { ok = await result.current.impersonate(7); });
        expect(ok).toBe(true);
        expect(getAccessToken()).toBe(IMP);
        expect(storageValues().filter((v) => v.includes(IMP) || v.includes(ADMIN))).toEqual([]);
    });

    it('start bumps the cross-tab identity epoch so other tabs re-mint (B2)', async () => {
        serveAuth([]);
        setAccessToken(ADMIN);
        const { result } = renderAuth();
        expect(localStorage.getItem(IDENTITY_EPOCH_KEY)).toBeNull();
        await act(async () => { await result.current.impersonate(7); });
        expect(localStorage.getItem(IDENTITY_EPOCH_KEY)).toMatch(/^\d+$/);
    });

    it('isImpersonating follows the in-memory claim, reactively (no other re-render trigger)', () => {
        setAccessToken(ADMIN);
        // Seeded + fresh: the query never fetches, so only the token store can re-render.
        const { result } = renderAuth({ id: 1, username: 'admin' });
        expect(result.current.isImpersonating).toBe(false);
        act(() => setAccessToken(IMP));
        expect(result.current.isImpersonating).toBe(true);
    });

    it('exit POSTs /auth/impersonate/exit, THEN refreshes to the admin token, with no "ended" toast', async () => {
        const calls: string[] = [];
        serveAuth(calls);
        setAccessToken(IMP);
        const { result } = renderAuth();
        let ok = false;
        await act(async () => { ok = await result.current.exitImpersonation(); });
        expect(calls.filter((c) => c !== 'start')).toEqual(['exit', 'refresh']);
        expect(ok).toBe(true);
        expect(getAccessToken()).toBe(ADMIN);
        expect(result.current.isImpersonating).toBe(false);
        expect(toast.info).not.toHaveBeenCalled();
    });

    it('an exit network failure does NOT refresh and keeps the impersonation (banner stays)', async () => {
        const calls: string[] = [];
        serveAuth(calls, () => HttpResponse.error());
        setAccessToken(IMP);
        const { result } = renderAuth();
        let ok = true;
        await act(async () => { ok = await result.current.exitImpersonation(); });
        expect(ok).toBe(false);
        expect(calls).toEqual(['exit']);
        expect(getAccessToken()).toBe(IMP);
        expect(result.current.isImpersonating).toBe(true);
        expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it('a refresh that drops the impersonatedBy claim shows "Impersonation ended"', async () => {
        serveAuth([]);
        setAccessToken(IMP);
        await ensureFreshToken();
        await waitFor(() => expect(getAccessToken()).toBe(ADMIN));
        expect(toast.info).toHaveBeenCalledWith('Impersonation ended');
    });
});
