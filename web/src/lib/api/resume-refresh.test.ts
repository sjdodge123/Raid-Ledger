/**
 * ROK-1947: a backgrounded phone tab's in-memory access token expires while
 * timers are paused. On resume (visibilitychange → visible, or a bfcache
 * restore) the token is refreshed BEFORE the next request needs it, and any
 * query that already failed with a 401 is refetched once the refresh lands.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { server } from '../../test/mocks/server';
import { AUTH_METHOD_KEY } from './auth-storage-keys';
import { clearAccessToken, getAccessToken, setAccessToken } from './access-token-store';
import { withHttpStatus } from './api-error';
import { installResumeRefresh } from './resume-refresh';

const API = 'http://localhost:3000';

function b64(obj: Record<string, unknown>): string {
    return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function tokenExpiringIn(seconds: number): string {
    return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u', exp: Math.floor(Date.now() / 1000) + seconds })}.sig`;
}

let refreshCalls = 0;
let uninstall: () => void = () => {};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

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

beforeEach(() => {
    refreshCalls = 0;
    localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    setAccessToken(tokenExpiringIn(-60));
    server.use(http.post(`${API}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ access_token: 'renewed-token' });
    }));
    uninstall = installResumeRefresh(client);
});
afterEach(() => { uninstall(); vi.restoreAllMocks(); localStorage.clear(); clearAccessToken(); client.clear(); });

describe('installResumeRefresh (ROK-1947)', () => {
    it('refreshes an expired in-memory token when the tab becomes visible', async () => {
        fireVisible();
        await vi.waitFor(() => expect(getAccessToken(), 'resume must re-mint the token').toBe('renewed-token'));
        expect(refreshCalls).toBe(1);
    });

    it('refreshes on a bfcache restore (pageshow persisted)', async () => {
        firePageShow(true);
        await vi.waitFor(() => expect(getAccessToken(), 'a bfcache restore must re-mint the token').toBe('renewed-token'));
    });

    it('does nothing for a fresh token, a hidden tab, a plain pageshow, or an anonymous visitor', async () => {
        firePageShow(false);
        setVisibility('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        localStorage.removeItem(AUTH_METHOD_KEY);
        fireVisible();
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        setAccessToken(tokenExpiringIn(3600));
        fireVisible();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(refreshCalls, 'none of these resumes needs a refresh').toBe(0);
    });

    it('refetches a query that failed with 401 once the resume refresh lands', async () => {
        let calls = 0;
        const queryFn = async (): Promise<string> => {
            calls += 1;
            if (calls === 1) throw withHttpStatus(new Error('Unauthorized'), 401);
            return 'ok';
        };
        await client.prefetchQuery({ queryKey: ['hub'], queryFn });
        fireVisible();
        await vi.waitFor(() => expect(client.getQueryData(['hub']), 'the 401 query must refetch after the refresh').toBe('ok'));
    });
});
