import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/mocks/server';
import { AUTH_METHOD_KEY, LEGACY_ACCESS_TOKEN_KEY } from './auth-storage-keys';

/**
 * ROK-1755 B1 → ROK-1754: several tabs in ONE browser share the `rl_rt`
 * cookie but each holds its own in-memory token (its own module instance).
 * Coordination is the `rl-refresh` Web Lock + the shared cookie jar only —
 * no token is ever adopted from storage.
 */

const API_BASE = 'http://localhost:3000';

type RefreshModule = typeof import('./refresh-client');
type StoreModule = typeof import('./access-token-store');
interface Tab { refresh: RefreshModule; store: StoreModule }

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

/** An unsigned JWT carrying the given claims (base64url). */
function jwtWith(claims: object): string {
    const seg = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${seg({ alg: 'HS256' })}.${seg(claims)}.sig`;
}

function setLocks(value: unknown): void {
    Object.defineProperty(navigator, 'locks', { value, configurable: true, writable: true });
}

/** A fresh module graph stands in for a separate browser tab. */
async function openTab(): Promise<Tab> {
    vi.resetModules();
    const refresh = await import('./refresh-client');
    const store = await import('./access-token-store');
    store.setAccessToken('old-token');
    return { refresh, store };
}

function countRefreshes(answer: (n: number) => Response): { calls: () => number } {
    let n = 0;
    server.use(http.post(`${API_BASE}/auth/refresh`, () => answer(++n)));
    return { calls: () => n };
}

/**
 * Models the server's cookie rotation: a POST that overlaps an in-progress
 * one presents the cookie that one is rotating → 409 `refresh_raced`.
 */
function rotatingServer(): { calls: () => number; raced: () => number } {
    let n = 0;
    let raced = 0;
    let busy = false;
    server.use(http.post(`${API_BASE}/auth/refresh`, async () => {
        n += 1;
        if (busy) {
            raced += 1;
            return HttpResponse.json({ code: 'refresh_raced' }, { status: 409 });
        }
        busy = true;
        await new Promise((r) => setTimeout(r, 5));
        busy = false;
        return HttpResponse.json({ access_token: `tok-${n}` });
    }));
    return { calls: () => n, raced: () => raced };
}

describe('refresh-client cross-tab coordination (ROK-1755 B1, ROK-1754)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        setLocks(undefined);
    });

    it('two tabs refreshing at once: the waiter POSTs with the rotated cookie — exactly 2 POSTs, 0 × 409', async () => {
        setLocks(createFakeLocks());
        const srv = rotatingServer();
        const tabA = await openTab();
        const tabB = await openTab();

        const [a, b] = await Promise.all([
            tabA.refresh.ensureFreshToken(),
            tabB.refresh.ensureFreshToken(),
        ]);

        expect(srv.calls()).toBe(2);
        expect(srv.raced()).toBe(0);
        expect(new Set([a, b])).toEqual(new Set(['tok-1', 'tok-2']));
        expect(tabA.store.getAccessToken()).toBe(a);
        expect(tabB.store.getAccessToken()).toBe(b);
        expect(localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY)).toBeNull();
    });

    it('without navigator.locks still single-flights inside one tab', async () => {
        setLocks(undefined);
        const counter = countRefreshes(() => HttpResponse.json({ access_token: 'solo' }));
        const tab = await openTab();

        const results = await Promise.all([
            tab.refresh.ensureFreshToken(),
            tab.refresh.ensureFreshToken(),
            tab.refresh.refreshWithOutcome(),
        ]);

        expect(counter.calls()).toBe(1);
        expect(results).toEqual(['solo', 'solo', { kind: 'ok', token: 'solo' }]);
    });

    it('a 409 refresh_raced is indeterminate and leaves the held token alone', async () => {
        setLocks(createFakeLocks());
        const counter = countRefreshes(() =>
            HttpResponse.json({ code: 'refresh_raced' }, { status: 409 }),
        );
        const tab = await openTab();

        expect(await tab.refresh.refreshWithOutcome()).toEqual({ kind: 'indeterminate' });
        expect(tab.store.getAccessToken()).toBe('old-token');
        // Exactly one retry after the race, never a loop.
        expect(counter.calls()).toBe(2);
    });

    it('a 409 refresh_raced retries ONCE with the rotated cookie and never adopts a stored token', async () => {
        setLocks(createFakeLocks());
        const counter = countRefreshes((n) => {
            if (n > 1) return HttpResponse.json({ access_token: 'own-token' });
            // An old-bundle tab won the race and wrote its token to storage.
            localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, 'sibling-token');
            return HttpResponse.json({ code: 'refresh_raced' }, { status: 409 });
        });
        const tab = await openTab();

        expect(await tab.refresh.refreshWithOutcome()).toEqual({ kind: 'ok', token: 'own-token' });
        expect(counter.calls()).toBe(2);
        expect(tab.store.getAccessToken()).toBe('own-token');
    });

    it('ROK-1753: USER_DEACTIVATED on refresh is terminal in every tab — one POST, session cleared', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        setLocks(createFakeLocks());
        const counter = countRefreshes(() =>
            HttpResponse.json({ code: 'USER_DEACTIVATED', message: 'Account deactivated' }, { status: 401 }),
        );
        const tabA = await openTab();
        const tabB = await openTab();

        const [a, b] = await Promise.all([
            tabA.refresh.refreshWithOutcome(),
            tabB.refresh.refreshWithOutcome(),
        ]);

        expect(a).toEqual({ kind: 'rejected' });
        expect(b).toEqual({ kind: 'rejected' });
        // The waiting tab sees the cleared marker and never replays the cookie.
        expect(counter.calls()).toBe(1);
        expect(tabA.store.getAccessToken()).toBeNull();
        expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
    });

    it('a token a sibling wrote to storage while this tab queued is never read — this tab POSTs its own', async () => {
        setLocks(locksAfterSibling(() =>
            localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, jwtWith({ sub: 1, exp: 4102444800 }))));
        const counter = countRefreshes(() => HttpResponse.json({ access_token: 'own-token' }));
        const tab = await openTab();

        expect(await tab.refresh.refreshWithOutcome()).toEqual({ kind: 'ok', token: 'own-token' });
        expect(counter.calls()).toBe(1);
    });

    it('a sibling that cleared the session while this tab queued → rejected, no POST', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        setLocks(locksAfterSibling(() => {
            localStorage.removeItem(AUTH_METHOD_KEY);
        }));
        const counter = countRefreshes(() => HttpResponse.json({ access_token: 'should-not-mint' }));
        const tab = await openTab();

        expect(await tab.refresh.refreshWithOutcome()).toEqual({ kind: 'rejected' });
        expect(counter.calls()).toBe(0);
    });

    it('impersonation is renewed by the queued refresh (server marker, D1) — one POST, claim preserved', async () => {
        const renewed = jwtWith({ sub: 7, impersonatedBy: 1, exp: 4102444800 });
        setLocks(locksAfterSibling(() => undefined));
        const counter = countRefreshes(() => HttpResponse.json({ access_token: renewed }));
        const tab = await openTab();
        tab.store.setAccessToken(jwtWith({ sub: 7, impersonatedBy: 1, exp: 1 }));

        expect(await tab.refresh.refreshWithOutcome()).toEqual({ kind: 'ok', token: renewed });
        expect(counter.calls()).toBe(1);
        expect(tab.store.isImpersonatingToken()).toBe(true);
    });
});
