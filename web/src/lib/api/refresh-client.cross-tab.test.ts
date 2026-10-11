import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/mocks/server';
import { ACCESS_TOKEN_KEY, AUTH_METHOD_KEY, ORIGINAL_TOKEN_KEY } from './auth-storage-keys';

/**
 * ROK-1755 B1: several tabs in ONE browser share the `rl_rt` cookie. Each tab
 * has its own module instance (its own in-tab `inFlight`), so cross-tab
 * coordination must come from `navigator.locks` + the shared localStorage.
 */

const API_BASE = 'http://localhost:3000';

type RefreshModule = typeof import('./refresh-client');

/** A FIFO exclusive lock per name — the subset of LockManager the client uses. */
function createFakeLocks() {
    const tails = new Map<string, Promise<unknown>>();
    return {
        request<T>(name: string, cb: () => Promise<T>): Promise<T> {
            const prev = tails.get(name) ?? Promise.resolve();
            const run = prev.then(cb, cb);
            tails.set(name, run.catch(() => undefined));
            return run;
        },
    };
}

/** A lock whose holder changes shared storage just before this tab gets it. */
function locksAfterSibling(sibling: () => void) {
    return {
        request<T>(_name: string, cb: () => Promise<T>): Promise<T> {
            sibling();
            return Promise.resolve().then(cb);
        },
    };
}

/** A JWT whose exp is `offsetSeconds` from now (base64url, unsigned). */
function jwtExpiringIn(offsetSeconds: number): string {
    const seg = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${seg({ alg: 'HS256' })}.${seg({ sub: '1', exp: Math.floor(Date.now() / 1000) + offsetSeconds })}.sig`;
}

function setLocks(value: unknown): void {
    Object.defineProperty(navigator, 'locks', { value, configurable: true, writable: true });
}

/** A fresh module instance stands in for a separate browser tab. */
async function openTab(): Promise<RefreshModule> {
    vi.resetModules();
    return import('./refresh-client');
}

function countRefreshes(answer: (n: number) => Response): { calls: () => number } {
    let n = 0;
    server.use(http.post(`${API_BASE}/auth/refresh`, () => answer(++n)));
    return { calls: () => n };
}

describe('refresh-client cross-tab coordination (ROK-1755 B1)', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(ACCESS_TOKEN_KEY, 'old-token');
    });

    afterEach(() => {
        setLocks(undefined);
    });

    it('two tabs refreshing at once make ONE POST; the second reuses the first tab token', async () => {
        setLocks(createFakeLocks());
        const counter = countRefreshes((n) => HttpResponse.json({ access_token: `tok-${n}` }));
        const tabA = await openTab();
        const tabB = await openTab();

        const [a, b] = await Promise.all([tabA.ensureFreshToken(), tabB.ensureFreshToken()]);

        expect(counter.calls()).toBe(1);
        expect(a).toBe('tok-1');
        expect(b).toBe('tok-1');
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('tok-1');
    });

    it('without navigator.locks still single-flights inside one tab', async () => {
        setLocks(undefined);
        const counter = countRefreshes(() => HttpResponse.json({ access_token: 'solo' }));
        const tab = await openTab();

        const results = await Promise.all([
            tab.ensureFreshToken(),
            tab.ensureFreshToken(),
            tab.refreshWithOutcome(),
        ]);

        expect(counter.calls()).toBe(1);
        expect(results).toEqual(['solo', 'solo', { kind: 'ok', token: 'solo' }]);
    });

    it('a 409 refresh_raced is indeterminate and leaves auth storage alone', async () => {
        setLocks(createFakeLocks());
        const counter = countRefreshes(() =>
            HttpResponse.json({ code: 'refresh_raced' }, { status: 409 }),
        );
        const tab = await openTab();

        expect(await tab.refreshWithOutcome()).toEqual({ kind: 'indeterminate' });
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('old-token');
        // Exactly one retry after the race, never a loop.
        expect(counter.calls()).toBe(2);
    });

    it('a 409 refresh_raced adopts a token another tab stored meanwhile', async () => {
        setLocks(createFakeLocks());
        const counter = countRefreshes(() => {
            // Another tab (old bundle, no lock) won the race and stored its token.
            localStorage.setItem(ACCESS_TOKEN_KEY, 'sibling-token');
            return HttpResponse.json({ code: 'refresh_raced' }, { status: 409 });
        });
        const tab = await openTab();

        expect(await tab.refreshWithOutcome()).toEqual({ kind: 'ok', token: 'sibling-token' });
        expect(counter.calls()).toBe(1);
    });

    it('ROK-1753: USER_DEACTIVATED on refresh is terminal in every tab — one POST, session cleared', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        setLocks(createFakeLocks());
        const counter = countRefreshes(() =>
            HttpResponse.json({ code: 'USER_DEACTIVATED', message: 'Account deactivated' }, { status: 401 }),
        );
        const tabA = await openTab();
        const tabB = await openTab();

        const [a, b] = await Promise.all([tabA.refreshWithOutcome(), tabB.refreshWithOutcome()]);

        expect(a).toEqual({ kind: 'rejected' });
        expect(b).toEqual({ kind: 'rejected' });
        // The waiting tab sees the cleared session and never replays the cookie.
        expect(counter.calls()).toBe(1);
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
        expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
    });

    it('a STALE token a sibling stored is not adopted — this tab still refreshes', async () => {
        setLocks(locksAfterSibling(() => localStorage.setItem(ACCESS_TOKEN_KEY, jwtExpiringIn(-60))));
        const counter = countRefreshes(() => HttpResponse.json({ access_token: 'own-token' }));
        const tab = await openTab();

        expect(await tab.refreshWithOutcome()).toEqual({ kind: 'ok', token: 'own-token' });
        expect(counter.calls()).toBe(1);
    });

    it('a sibling that cleared the session while this tab queued → rejected, no POST', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        setLocks(locksAfterSibling(() => {
            localStorage.removeItem(ACCESS_TOKEN_KEY);
            localStorage.removeItem(AUTH_METHOD_KEY);
        }));
        const counter = countRefreshes(() => HttpResponse.json({ access_token: 'should-not-mint' }));
        const tab = await openTab();

        expect(await tab.refreshWithOutcome()).toEqual({ kind: 'rejected' });
        expect(counter.calls()).toBe(0);
    });

    it('impersonation that began while this tab queued is re-checked inside the lock — no POST', async () => {
        setLocks(locksAfterSibling(() => localStorage.setItem(ORIGINAL_TOKEN_KEY, 'admin-token')));
        const counter = countRefreshes(() => HttpResponse.json({ access_token: 'admin-swap' }));
        const tab = await openTab();

        expect(await tab.refreshWithOutcome()).toEqual({ kind: 'indeterminate' });
        expect(counter.calls()).toBe(0);
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('old-token');
    });
});
