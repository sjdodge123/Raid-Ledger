import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { getAuthToken, setAuthToken, useAuth } from './use-auth';

const TOKEN_KEY = 'raid_ledger_token';

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

    it('stores the token under the expected localStorage key', () => {
        setAuthToken('my-token');
        expect(localStorage.getItem(TOKEN_KEY)).toBe('my-token');
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
        vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.includes('/auth/refresh')) {
                return Promise.resolve(new Response('Unauthorized', { status: 401 }));
            }
            if (url.includes('/auth/me')) {
                return Promise.resolve(new Response(JSON.stringify(mockUser), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            return Promise.resolve(new Response('Not Found', { status: 404 }));
        });

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
