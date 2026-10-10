import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/mocks/server';
import { ACCESS_TOKEN_KEY } from './auth-storage-keys';

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
        countRefreshes(() => HttpResponse.json({ code: 'refresh_raced' }, { status: 409 }));
        const tab = await openTab();

        expect(await tab.refreshWithOutcome()).toEqual({ kind: 'indeterminate' });
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('old-token');
    });

    it('a 409 refresh_raced adopts a token another tab stored meanwhile', async () => {
        setLocks(createFakeLocks());
        countRefreshes(() => {
            // Another tab (old bundle, no lock) won the race and stored its token.
            localStorage.setItem(ACCESS_TOKEN_KEY, 'sibling-token');
            return HttpResponse.json({ code: 'refresh_raced' }, { status: 409 });
        });
        const tab = await openTab();

        expect(await tab.refreshWithOutcome()).toEqual({ kind: 'ok', token: 'sibling-token' });
    });
});
