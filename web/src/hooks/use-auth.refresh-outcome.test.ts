/**
 * ROK-1754 review M1 (§3.2, ROK-1366 #1384): only a REJECTED refresh (401/403)
 * ends the session. An indeterminate one (429, 5xx, network) must keep the
 * seeded user, keep the user cache, and never start a silent re-auth redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { fetchCurrentUser } from './use-auth';
import { attemptSilentReauth } from '../lib/api/silent-reauth';
import { clearAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { AUTH_METHOD_KEY, USER_CACHE_KEY } from '../lib/api/auth-storage-keys';

vi.mock('../lib/api/silent-reauth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/api/silent-reauth')>()),
    attemptSilentReauth: vi.fn(),
}));

const API = 'http://localhost:3000';
const cached = { id: 3, username: 'Cached', discordId: '3', displayName: null, avatar: null, customAvatarUrl: null, steamId: null, onboardingCompletedAt: null };

function seededClient(): QueryClient {
    localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(cached));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData(['auth', 'me'], cached);
    return qc;
}

/** The App.tsx boot prefetch. */
function prefetchMe(qc: QueryClient): Promise<void> {
    return qc.prefetchQuery({ queryKey: ['auth', 'me'], queryFn: fetchCurrentUser, staleTime: 0 });
}

function refreshAnswers(status: number | 'network'): void {
    server.use(http.post(`${API}/auth/refresh`, () =>
        status === 'network' ? HttpResponse.error() : new HttpResponse(null, { status })));
}

function expectSessionKept(qc: QueryClient): void {
    expect(qc.getQueryData(['auth', 'me']), 'the seeded user survives').toEqual(cached);
    expect(localStorage.getItem(USER_CACHE_KEY), 'the user cache survives').not.toBeNull();
    expect(attemptSilentReauth, 'no silent re-auth redirect').not.toHaveBeenCalled();
}

function expectLoggedOut(qc: QueryClient): void {
    expect(qc.getQueryData(['auth', 'me'])).toBeNull();
    expect(localStorage.getItem(USER_CACHE_KEY)).toBeNull();
    expect(attemptSilentReauth).toHaveBeenCalledTimes(1);
}

describe('ROK-1754 M1: boot with no in-memory token', () => {
    beforeEach(() => {
        localStorage.clear();
        clearAccessToken();
        vi.mocked(attemptSilentReauth).mockClear();
    });

    it.each([429, 503, 'network' as const])('an indeterminate refresh (%s) keeps the cached user and does not redirect', async (status) => {
        refreshAnswers(status);
        const qc = seededClient();
        await prefetchMe(qc);
        expectSessionKept(qc);
    });

    it.each([401, 403])('a rejected refresh (%i) still logs out', async (status) => {
        refreshAnswers(status);
        const qc = seededClient();
        await prefetchMe(qc);
        expectLoggedOut(qc);
    });
});

describe('ROK-1754 M1: /auth/me 401 → refresh-and-retry branch', () => {
    beforeEach(() => {
        localStorage.clear();
        setAccessToken('expired.jwt');
        vi.mocked(attemptSilentReauth).mockClear();
        server.use(http.get(`${API}/auth/me`, () => HttpResponse.json({}, { status: 401 })));
    });

    it.each([429, 503, 'network' as const])('an indeterminate refresh (%s) keeps the cached user and does not redirect', async (status) => {
        refreshAnswers(status);
        const qc = seededClient();
        await prefetchMe(qc);
        expectSessionKept(qc);
    });

    it('a rejected refresh still logs out', async () => {
        refreshAnswers(401);
        const qc = seededClient();
        await prefetchMe(qc);
        expectLoggedOut(qc);
    });
});
