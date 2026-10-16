import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { fetchCurrentUser, getAuthToken, setAuthToken, useAuth } from './use-auth';
import { startMagicLinkRedeem } from '../lib/magic-link-redeem';
import { getAccessToken } from '../lib/api/access-token-store';


describe('setAuthToken / getAuthToken', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('stores a token retrievable by getAuthToken', () => {
        setAuthToken('test-jwt-token');
        expect(getAuthToken()).toBe('test-jwt-token');
    });

    it('overwrites an existing token', () => {
        setAuthToken('old-token');
        setAuthToken('new-token');
        expect(getAuthToken()).toBe('new-token');
    });

    it('ROK-1754: holds the token in memory and never in localStorage', () => {
        setAuthToken('my-token');
        expect(getAccessToken()).toBe('my-token');
        expect(Object.values({ ...localStorage })).not.toContain('my-token');
    });
});

describe('useAuth login — events cache invalidation (ROK-691)', () => {
    let queryClient: QueryClient;

    function createWrapper() {
        return function Wrapper({ children }: { children: ReactNode }) {
            return createElement(QueryClientProvider, { client: queryClient }, children);
        };
    }

    beforeEach(() => {
        localStorage.clear();
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false, gcTime: Infinity },
            },
        });
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('invalidates events queries after successful login', async () => {
        // Seed a stale events cache entry (as if the calendar was visited pre-login)
        queryClient.setQueryData(['events', { upcoming: true }], { data: [] });

        // Spy on invalidateQueries to verify it's called with ['events']
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        // Route-aware fetch mock (ROK-1353): mounting useAuth with no access
        // token now attempts a transparent POST /auth/refresh before settling
        // on logged-out, so a single mockResolvedValueOnce would be consumed
        // by that probe instead of login's /auth/me call.
        const mockUser = { id: 1, username: 'TestUser', discordId: '123', displayName: null, avatar: null, customAvatarUrl: null, onboardingCompletedAt: null };
        // ROK-1754 §3.6: /auth/me goes through nativeFetch (captured at load), so
        // a later `fetch` spy never sees it — route through MSW instead.
        server.use(
            http.post('http://localhost:3000/auth/refresh', () => new HttpResponse(null, { status: 401 })),
            http.get('http://localhost:3000/auth/me', () => HttpResponse.json(mockUser)),
        );

        const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.login('test-jwt-token');
        });

        // Verify events cache was invalidated
        expect(invalidateSpy).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: ['events'] }),
        );

        invalidateSpy.mockRestore();
        vi.restoreAllMocks();
    });
});

describe('ROK-1366: fetchCurrentUser awaits a pending magic-link redeem', () => {
    const API = 'http://localhost:3000';
    const redeemedUser = { id: 7, username: 'Linked', discordId: '7', displayName: null, avatar: null, customAvatarUrl: null, steamId: null, onboardingCompletedAt: null };

    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('decides only after the redeem settles, then uses the minted session', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        server.use(
            http.post(`${API}/auth/redeem-magic-link`, async () => {
                await gate;
                return HttpResponse.json({ access_token: 'session.jwt' });
            }),
            http.get(`${API}/auth/me`, ({ request }) =>
                request.headers.get('authorization') === 'Bearer session.jwt'
                    ? HttpResponse.json(redeemedUser)
                    : HttpResponse.json({}, { status: 401 }),
            ),
        );

        const redeem = startMagicLinkRedeem('magic.jwt.raw');
        const userPromise = fetchCurrentUser();
        release();
        await redeem;

        await expect(userPromise).resolves.toMatchObject({ id: 7, username: 'Linked' });
        expect(getAuthToken()).toBe('session.jwt');
    });
});

/**
 * ROK-1599 (Codex P1): the Calendars overview carries the viewer's working
 * subscribe-feed URL (a bearer link). Its cache key is not viewer-scoped, so
 * every identity change must drop it or the next viewer on this browser sees
 * the previous viewer's link.
 */
describe('useAuth identity change — drops viewer-private calendar caches (ROK-1599)', () => {
    const OVERVIEW = ['calendars', 'overview'];
    const userA = { id: 1, username: 'A', discordId: '1', displayName: null, avatar: null, customAvatarUrl: null, onboardingCompletedAt: null };
    const userB = { ...userA, id: 2, username: 'B', discordId: '2' };
    let queryClient: QueryClient;
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);

    beforeEach(() => {
        localStorage.clear();
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        queryClient.setQueryData(OVERVIEW, { feed: { url: 'https://x/api/cal/u/user-a-token.ics' } });
        server.use(
            http.post('http://localhost:3000/auth/refresh', () => new HttpResponse(null, { status: 401 })),
            http.post('http://localhost:3000/auth/logout', () => new HttpResponse(null, { status: 204 })),
            http.get('http://localhost:3000/auth/me', () => HttpResponse.json(userB)),
        );
    });

    afterEach(() => { localStorage.clear(); });

    it('logout removes the cached overview (and its feed link)', () => {
        queryClient.setQueryData(['auth', 'me'], userA);
        const { result } = renderHook(() => useAuth(), { wrapper });
        act(() => { result.current.logout(); });
        expect(queryClient.getQueryData(OVERVIEW)).toBeUndefined();
    });

    it('login as another user removes the previous viewer overview', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await act(async () => { await result.current.login('user-b-jwt'); });
        expect(queryClient.getQueryData(OVERVIEW)).toBeUndefined();
    });
});
