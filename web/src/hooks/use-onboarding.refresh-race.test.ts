/**
 * ROK-1820 item 2: a refresh POSTed before the password change (under the
 * pre-change session) and answered after the change must not overwrite the
 * session the change re-issued, nor sign the admin out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { refreshWithOutcome } from '../lib/api/refresh-client';
import { clearAccessToken, getAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { AUTH_METHOD_KEY } from '../lib/api/auth-storage-keys';
import { defined } from '../test/defined';
import { useOnboarding } from './use-onboarding';

vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const API = 'http://localhost:3000';

/** The refresh POST is held until `release()`; it answers with `stale.jwt`. */
function gatedRefresh(): () => void {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post(`${API}/auth/refresh`, async () => {
        await gate;
        return HttpResponse.json({ access_token: 'stale.jwt' });
    }));
    return () => defined(release, 'refresh gate release')();
}

function changePasswordReturns(token: string): void {
    server.use(http.post(`${API}/admin/onboarding/change-password`, () =>
        HttpResponse.json({ success: true, message: 'ok', access_token: token })));
}

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return renderHook(() => useOnboarding(), { wrapper }).result;
}

describe('ROK-1820: password change vs a late in-flight refresh', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        clearAccessToken();
        setAccessToken('old.jwt');
    });

    it('a refresh started before the change and resolving after it does not replace the new token', async () => {
        const release = gatedRefresh();
        changePasswordReturns('fresh.jwt');
        const stale = refreshWithOutcome();
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        await waitFor(() => expect(result.current.changePassword.isSuccess).toBe(true));
        expect(getAccessToken()).toBe('fresh.jwt');
        release();
        await expect(stale).resolves.toEqual({ kind: 'indeterminate' });
        expect(getAccessToken(), 'the late pre-change refresh must not overwrite the re-issued token').toBe('fresh.jwt');
    });

    it('the dropped late refresh does not sign the admin out', async () => {
        const release = gatedRefresh();
        changePasswordReturns('fresh.jwt');
        const stale = refreshWithOutcome();
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        await waitFor(() => expect(result.current.changePassword.isSuccess).toBe(true));
        release();
        await stale;
        expect(localStorage.getItem(AUTH_METHOD_KEY), 'the session marker survives').toBe('local');
        expect(getAccessToken()).not.toBeNull();
    });
});

/** A FIFO exclusive Web Lock per name; `outstanding` counts holder + waiters. */
function createFakeLocks() {
    const tails = new Map<string, Promise<unknown>>();
    const counts = new Map<string, number>();
    const bump = (name: string, by: number) => counts.set(name, (counts.get(name) ?? 0) + by);
    return {
        outstanding: (name: string): number => counts.get(name) ?? 0,
        request<T>(name: string, cb: () => Promise<T>): Promise<T> {
            bump(name, 1);
            const prev = tails.get(name) ?? Promise.resolve();
            const run = prev.then(cb, cb).finally(() => bump(name, -1));
            tails.set(name, run.catch(() => undefined));
            return run;
        },
    };
}

function setLocks(value: unknown): void {
    Object.defineProperty(navigator, 'locks', { value, configurable: true, writable: true });
}

/** An unsigned JWT carrying the given claims (base64url). */
function jwtWith(claims: object): string {
    const seg = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${seg({ alg: 'HS256' })}.${seg(claims)}.sig`;
}

/**
 * The change 401s unless sent with `refreshed.jwt`, which the refresh hands
 * out. Returns a reader for how many refresh POSTs were made.
 */
function revokedUntilRefreshed(): () => number {
    let posts = 0;
    server.use(http.post(`${API}/auth/refresh`, () => {
        posts += 1;
        return HttpResponse.json({ access_token: 'refreshed.jwt' });
    }));
    server.use(http.post(`${API}/admin/onboarding/change-password`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer refreshed.jwt'
            ? HttpResponse.json({ success: true, message: 'ok', access_token: 'fresh.jwt' })
            : HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })));
    return () => posts;
}

type Onboarding = ReturnType<typeof setup>;
const settled = (r: Onboarding): boolean => r.current.changePassword.isSuccess || r.current.changePassword.isError;

describe('ROK-1820: password change under the rl-refresh Web Lock', () => {
    let locks: ReturnType<typeof createFakeLocks>;

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        clearAccessToken();
        setAccessToken('old.jwt');
        locks = createFakeLocks();
        setLocks(locks);
    });

    afterEach(() => { setLocks(undefined); });

    it('waits out a refresh holding the lock and drops its token instead of installing it over the change', async () => {
        const release = gatedRefresh();
        changePasswordReturns('fresh.jwt');
        const stale = refreshWithOutcome();
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        // The change either queued behind the refresh's lock (fixed) or already ran unfenced.
        await waitFor(() => expect(settled(result) || locks.outstanding('rl-refresh') > 1).toBe(true));
        release();
        await waitFor(() => expect(result.current.changePassword.isSuccess).toBe(true));
        await expect(stale).resolves.toEqual({ kind: 'indeterminate' });
        expect(getAccessToken(), 'the lock-held pre-change refresh must not overwrite the re-issued token').toBe('fresh.jwt');
        expect(localStorage.getItem(AUTH_METHOD_KEY), 'the session marker survives').toBe('local');
    });

    it('a 401 while the change holds the lock settles as an error instead of deadlocking on rl-refresh', async () => {
        server.use(http.post(`${API}/admin/onboarding/change-password`, () =>
            HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })));
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        await waitFor(() => expect(settled(result), 'the change settles (no rl-refresh self-deadlock)').toBe(true));
        expect(result.current.changePassword.isError).toBe(true);
        expect(localStorage.getItem(AUTH_METHOD_KEY), 'an in-lock refresh is indeterminate, never a sign-out').toBe('local');
    });

    it('a password change sent with a stale access token refreshes first and succeeds', async () => {
        setAccessToken(jwtWith({ exp: Math.floor(Date.now() / 1000) - 60 }));
        server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.json({ access_token: 'refreshed.jwt' })));
        server.use(http.post(`${API}/admin/onboarding/change-password`, ({ request }) =>
            request.headers.get('Authorization') === 'Bearer refreshed.jwt'
                ? HttpResponse.json({ success: true, message: 'ok', access_token: 'fresh.jwt' })
                : HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })));
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        await waitFor(() => expect(settled(result)).toBe(true));
        expect(result.current.changePassword.status, 'the stale token is refreshed before the lock, so the change carries a live token').toBe('success');
        expect(getAccessToken()).toBe('fresh.jwt');
    });

    it('a password change from a tab holding an unexpired but revoked token recovers via one refresh and succeeds', async () => {
        // Another tab changed the password: this tab's token is unexpired (no
        // preflight refresh) but blocklisted, while the shared cookie is live.
        setAccessToken(jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 }));
        const refreshPosts = revokedUntilRefreshed();
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        await waitFor(() => expect(settled(result)).toBe(true));
        expect(result.current.changePassword.status, 'the 401 under the lock recovers by refreshing outside it and retrying').toBe('success');
        expect(refreshPosts(), 'exactly one recovery refresh').toBe(1);
        expect(getAccessToken()).toBe('fresh.jwt');
        expect(locks.outstanding('rl-refresh'), 'no lock left held or queued').toBe(0);
    });
});
