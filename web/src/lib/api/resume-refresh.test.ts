/**
 * ROK-1947: a backgrounded phone tab's in-memory access token expires while
 * timers are paused. On resume (visibilitychange → visible, a bfcache restore,
 * or `online`) the token is refreshed BEFORE the next request needs it, and
 * after ANY successful refresh the active queries that failed with a 401 are
 * refetched. An indeterminate or rejected refresh refetches nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { server } from '../../test/mocks/server';
import { AUTH_METHOD_KEY } from './auth-storage-keys';
import { clearAccessToken, getAccessToken, setAccessToken } from './access-token-store';
import { withHttpStatus } from './api-error';
import type * as RefreshClient from './refresh-client';
import { ensureFreshToken } from './refresh-client';
import { installResumeRefresh } from './resume-refresh';

vi.mock('./refresh-client', async (importOriginal) => {
    const real = await importOriginal<typeof RefreshClient>();
    return { ...real, ensureFreshToken: vi.fn(real.ensureFreshToken) };
});

const API = 'http://localhost:3000';

function b64(obj: Record<string, unknown>): string {
    return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function tokenExpiringIn(seconds: number): string {
    return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u', exp: Math.floor(Date.now() / 1000) + seconds })}.sig`;
}

let refreshCalls = 0;
let uninstall: () => void = () => {};
let unsubscribers: Array<() => void> = [];
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function serveRefresh(status: number): void {
    server.use(http.post(`${API}/auth/refresh`, () => {
        refreshCalls += 1;
        return status === 200
            ? HttpResponse.json({ access_token: 'renewed-token' })
            : HttpResponse.json({ message: 'no' }, { status });
    }));
}
function setVisibility(state: DocumentVisibilityState): void {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}
function fireVisible(): void {
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
}
function firePageShow(persisted: boolean): void {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted }));
}
/** The refresh the resume started — awaited so a negative assertion is deterministic. */
function lastRefresh(): Promise<string | null> {
    const result = vi.mocked(ensureFreshToken).mock.results.at(-1);
    if (!result) throw new Error('no refresh was started');
    return result.value;
}
/** An ACTIVE query (one observer) whose first fetch fails with a 401; `calls()` counts fetches. */
async function observeUnauthorized(key: string): Promise<{ calls: () => number }> {
    let calls = 0;
    const queryFn = async (): Promise<string> => {
        calls += 1;
        if (calls === 1) throw withHttpStatus(new Error('Unauthorized'), 401);
        return 'ok';
    };
    const observer = new QueryObserver(client, { queryKey: [key], queryFn });
    unsubscribers.push(observer.subscribe(() => {}));
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('error'));
    return { calls: () => calls };
}

/**
 * An ACTIVE query that 401s every time; each refetch runs its 401 backstop
 * refresh (as `fetchWithAuth` does) after `lagMs`, so two of them stagger.
 */
async function observeStill401(key: string, lagMs: number): Promise<{ calls: () => number }> {
    let calls = 0;
    const queryFn = async (): Promise<string> => {
        calls += 1;
        if (calls > 1) {
            await new Promise((resolve) => setTimeout(resolve, lagMs));
            await ensureFreshToken();
        }
        throw withHttpStatus(new Error('Unauthorized'), 401);
    };
    const observer = new QueryObserver(client, { queryKey: [key], queryFn });
    unsubscribers.push(observer.subscribe(() => {}));
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('error'));
    return { calls: () => calls };
}

beforeEach(() => {
    refreshCalls = 0;
    vi.mocked(ensureFreshToken).mockClear();
    localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    setAccessToken(tokenExpiringIn(-60));
    serveRefresh(200);
    uninstall = installResumeRefresh(client);
});
afterEach(() => {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    uninstall(); vi.restoreAllMocks(); localStorage.clear(); clearAccessToken(); client.clear();
});

describe('installResumeRefresh (ROK-1947)', () => {
    it('refreshes an expired in-memory token when the tab becomes visible', async () => {
        fireVisible();
        await vi.waitFor(() => expect(getAccessToken(), 'resume must re-mint the token').toBe('renewed-token'));
        expect(refreshCalls).toBe(1);
    });

    it('refreshes on a bfcache restore (pageshow persisted) and when the network comes back', async () => {
        firePageShow(true);
        await vi.waitFor(() => expect(getAccessToken(), 'a bfcache restore must re-mint the token').toBe('renewed-token'));
        setAccessToken(tokenExpiringIn(-60));
        window.dispatchEvent(new Event('online'));
        await vi.waitFor(() => expect(refreshCalls, '`online` must re-check a stale token').toBe(2));
    });

    it('does nothing for a fresh token, a hidden tab, a plain pageshow, or an anonymous visitor', () => {
        firePageShow(false);
        setVisibility('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        localStorage.removeItem(AUTH_METHOD_KEY);
        fireVisible();
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        setAccessToken(tokenExpiringIn(3600));
        fireVisible();
        window.dispatchEvent(new Event('online'));
        // The guard returns before any await, so "not called" is final here.
        expect(ensureFreshToken, 'none of these resumes needs a refresh').not.toHaveBeenCalled();
    });

    it('refetches an active 401 query once the resume refresh lands, but not an inactive one', async () => {
        const active = await observeUnauthorized('hub');
        let inactiveCalls = 0;
        await client.prefetchQuery({ queryKey: ['inactive'], queryFn: async () => { inactiveCalls += 1; throw withHttpStatus(new Error('Unauthorized'), 401); } });
        fireVisible();
        await vi.waitFor(() => expect(client.getQueryData(['hub']), 'the 401 query must refetch after the refresh').toBe('ok'));
        expect(active.calls()).toBe(2);
        expect(inactiveCalls, 'an inactive cached query is not refetched').toBe(1);
    });

    it('refetches 401 queries after the pre-request refresh too, not only after a resume', async () => {
        await observeUnauthorized('hub');
        await ensureFreshToken();
        await vi.waitFor(() => expect(client.getQueryData(['hub']), 'any successful refresh must refetch 401 queries').toBe('ok'));
    });

    it.each([[503, 'indeterminate'], [401, 'rejected']])('a %s (%s) resume refresh refetches nothing', async (status) => {
        serveRefresh(status);
        const active = await observeUnauthorized('hub');
        fireVisible();
        expect(await lastRefresh(), 'the refresh produced no token').toBeNull();
        expect(active.calls(), 'no token, so the 401 query is not refetched').toBe(1);
    });

    it('two queries that still 401 do not restart each other through their own backstop refreshes', async () => {
        const first = await observeStill401('first', 0);
        const second = await observeStill401('second', 15);
        await ensureFreshToken();
        await vi.waitFor(() => expect(second.calls(), 'the refresh refetches both 401 queries').toBe(2));
        // Unbounded, each backstop refresh restarted the other query every ~15ms.
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(first.calls(), 'a refresh from the batch\'s own refetch must not restart a query again').toBe(2);
        expect(second.calls(), 'one refetch per query per refresh batch').toBe(2);
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    });
});
