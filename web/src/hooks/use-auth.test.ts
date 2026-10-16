import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { fetchCurrentUser, getAuthToken, setAuthToken, useAuth } from './use-auth';
import { startMagicLinkRedeem } from '../lib/magic-link-redeem';
import { getAccessToken } from '../lib/api/access-token-store';
import { dropViewerPrivateCaches } from './viewer-private-caches';


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
/** ROK-1599 + ROK-1811: an identity change empties every viewer-private cache, not an allow-list. */
describe('useAuth identity change — clears the whole query cache (ROK-1599, ROK-1811)', () => {
    const PRIVATE_KEYS = [
        ['calendars', 'overview'],
        ['notifications', 20, 0],
        ['notifications', 'unread-count'],
        ['me', 'characters', 1],
    ];
    const userA = { id: 1, username: 'A', discordId: '1', displayName: null, avatar: null, customAvatarUrl: null, onboardingCompletedAt: null };
    const userB = { ...userA, id: 2, username: 'B', discordId: '2' };
    let queryClient: QueryClient;
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);

    beforeEach(() => {
        localStorage.clear();
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        for (const key of PRIVATE_KEYS) queryClient.setQueryData(key, { ownedBy: userA.id });
        server.use(
            http.post('http://localhost:3000/auth/refresh', () => new HttpResponse(null, { status: 401 })),
            http.post('http://localhost:3000/auth/logout', () => new HttpResponse(null, { status: 204 })),
            http.get('http://localhost:3000/auth/me', () => HttpResponse.json(userB)),
        );
    });

    afterEach(() => { localStorage.clear(); });

    it('logout removes the previous viewer\'s notifications, characters and overview, and signs out', () => {
        queryClient.setQueryData(['auth', 'me'], userA);
        const { result } = renderHook(() => useAuth(), { wrapper });
        act(() => { result.current.logout(); });
        expect(PRIVATE_KEYS.map((key) => queryClient.getQueryData(key))).toEqual(PRIVATE_KEYS.map(() => undefined));
        expect(queryClient.getQueryData(['auth', 'me'])).toBeNull();
    });

    it('login as another user removes the previous viewer\'s caches and seeds the new identity', async () => {
        queryClient.setQueryData(['auth', 'me'], userA);
        const { result } = renderHook(() => useAuth(), { wrapper });
        await act(async () => { await result.current.login('user-b-jwt'); });
        expect(PRIVATE_KEYS.map((key) => queryClient.getQueryData(key))).toEqual(PRIVATE_KEYS.map(() => undefined));
        expect(queryClient.getQueryData(['auth', 'me'])).toEqual(userB);
    });
});

/**
 * ROK-1811 (Codex P1): the drop must keep the LIVE `['auth','me']` Query, not
 * just its payload — mounted `useAuth()` observers are attached to it, so a
 * later sign-out (a cross-tab logout seeding null) has to reach the hook.
 */
describe('useAuth through an identity drop (ROK-1811)', () => {
    const API = 'http://localhost:3000';
    const PRIVATE_KEYS = [['notifications', 20, 0], ['me', 'characters', 1], ['calendars', 'overview']];
    const userA = { id: 1, username: 'A', discordId: '1', displayName: null, avatar: null, customAvatarUrl: null, steamId: null, onboardingCompletedAt: null };
    let queryClient: QueryClient;
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
    const privateData = () => PRIVATE_KEYS.map((key) => queryClient.getQueryData(key));

    beforeEach(() => {
        localStorage.clear();
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        for (const key of PRIVATE_KEYS) queryClient.setQueryData(key, { ownedBy: userA.id });
    });
    afterEach(() => { localStorage.clear(); setAuthToken(''); });

    // React Query notifies observers on a macrotask, hence waitFor (the old
    // clear+restore never notifies: waitFor then fails on this assertion).
    it('a sign-out seeded after the drop reaches the mounted hook', async () => {
        queryClient.setQueryData(['auth', 'me'], userA);
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.user).toEqual(userA);
        act(() => { dropViewerPrivateCaches(queryClient); });
        act(() => { queryClient.setQueryData(['auth', 'me'], null); });
        await waitFor(() => { expect(result.current.user).toBeNull(); });
        expect(privateData()).toEqual(PRIVATE_KEYS.map(() => undefined));
    });

    it('a rejected re-mint after exiting impersonation drops the target user\'s caches and signs out', async () => {
        queryClient.setQueryData(['auth', 'me'], userA);
        server.use(
            http.post(`${API}/auth/impersonate/exit`, () => new HttpResponse(null, { status: 204 })),
            http.post(`${API}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
        );
        const { result } = renderHook(() => useAuth(), { wrapper });
        await act(async () => { await result.current.exitImpersonation(); });
        expect(privateData()).toEqual(PRIVATE_KEYS.map(() => undefined));
        await waitFor(() => { expect(result.current.user).toBeNull(); });
    });

    it('session expiry (refresh rejected) drops the previous viewer\'s caches', async () => {
        setAuthToken('expired.jwt');
        server.use(
            http.get(`${API}/auth/me`, () => HttpResponse.json({}, { status: 401 })),
            http.post(`${API}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
        );
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => { expect(result.current.isLoading).toBe(false); });
        expect(result.current.user).toBeNull();
        expect(privateData()).toEqual(PRIVATE_KEYS.map(() => undefined));
    });
});
