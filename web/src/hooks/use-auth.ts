import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import { ensureFreshToken } from '../lib/api/refresh-client';
import { clearSilentGuard, clearAuthMethod, getAuthMethod, attemptSilentReauth } from '../lib/api/silent-reauth';
import type { UserRole } from '@raid-ledger/contract';

const TOKEN_KEY = 'raid_ledger_token';
const ORIGINAL_TOKEN_KEY = 'raid_ledger_original_token';
const USER_CACHE_KEY = 'raid_ledger_user_cache';

export interface User {
    id: number;
    discordId: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
    customAvatarUrl: string | null;
    role?: UserRole;
    steamId: string | null;
    onboardingCompletedAt: string | null;
    avatarPreference?: { type: 'custom' | 'discord' | 'character'; characterName?: string } | null;
    resolvedAvatarUrl?: string | null;
}

/** Check if user has admin role */
export function isAdmin(user: User | null | undefined): boolean {
    return user?.role === 'admin';
}

/** Check if user has operator or admin role */
export function isOperatorOrAdmin(user: User | null | undefined): boolean {
    return user?.role === 'operator' || user?.role === 'admin';
}

/**
 * Get stored auth token
 */
export function getAuthToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * Store an auth token (e.g., from a magic link).
 * Does NOT trigger React Query invalidation — call login() for that.
 */
export function setAuthToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Check if currently in impersonation mode
 */
export function isImpersonating(): boolean {
    return !!localStorage.getItem(ORIGINAL_TOKEN_KEY);
}

/**
 * Read cached user from localStorage (for instant perceived load on return visits).
 */
export function getCachedUser(): User | null {
    try {
        const cached = localStorage.getItem(USER_CACHE_KEY);
        return cached ? JSON.parse(cached) : null;
    } catch {
        return null;
    }
}

/**
 * Fetch current authenticated user from /auth/me.
 *
 * Returns null for explicit "not authenticated" (no token, 401).
 * Throws on network/server errors so React Query preserves any
 * seeded cache data instead of overwriting it with null.
 */
function clearAllAuthStorage(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ORIGINAL_TOKEN_KEY);
    localStorage.removeItem(USER_CACHE_KEY);
}

/**
 * ROK-1353: revoke the refresh family + clear the `rl_rt` cookie server-side.
 * Best-effort — swallows network errors so client logout always proceeds.
 */
async function serverLogout(): Promise<void> {
    try {
        await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        });
    } catch {
        // ignore — local storage is cleared regardless
    }
}

/** GET /auth/me with the current Bearer token. */
function fetchMe(token: string): Promise<Response> {
    return fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
    });
}

/**
 * ROK-1353: refresh failed — clear storage and, for a Discord-linked user,
 * attempt ONE silent re-auth redirect before settling on the login screen.
 */
function handleRefreshFailure(): null {
    clearAllAuthStorage();
    attemptSilentReauth(window.location.pathname + window.location.search);
    return null;
}

export async function fetchCurrentUser(): Promise<User | null> {
    let token = getAuthToken();
    if (!token) {
        // ROK-1353: no access token but a refresh cookie may still be live —
        // try a transparent refresh before deciding the user is logged out.
        // Only probe when a prior session left its auth-method marker:
        // fresh anonymous visitors have no refresh cookie, and the probe's
        // async 401 re-renders the login page mid-interaction (it collapses
        // the username form under the user's cursor).
        if (!getAuthMethod()) return null;
        token = await ensureFreshToken();
        if (!token) return handleRefreshFailure();
    }

    let response = await fetchMe(token);

    // ROK-1353: a 401 means the access token expired — refresh from the
    // httpOnly cookie and retry once before clearing storage.
    if (response.status === 401) {
        const refreshed = await ensureFreshToken();
        if (refreshed) {
            response = await fetchMe(refreshed);
        }
        if (response.status === 401) {
            return handleRefreshFailure();
        }
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const user: User = await response.json();
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    return user;
}

/**
 * Hook to get the current authenticated user
 * Returns null when not authenticated
 */
function useLogin(queryClient: ReturnType<typeof useQueryClient>) {
    return useCallback(async (token: string): Promise<User | null> => {
        localStorage.setItem(TOKEN_KEY, token);
        try {
            const user = await fetchCurrentUser();
            queryClient.setQueryData(['auth', 'me'], user);
            queryClient.invalidateQueries({ queryKey: ['events'] });
            return user;
        } catch (error) {
            console.error('Failed to fetch user after login:', error);
            return null;
        }
    }, [queryClient]);
}

async function performImpersonation(userId: number, queryClient: ReturnType<typeof useQueryClient>): Promise<boolean> {
    const token = getAuthToken();
    if (!token) return false;

    try {
        const response = await fetch(`${API_BASE_URL}/auth/impersonate/${userId}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        localStorage.setItem(ORIGINAL_TOKEN_KEY, data.original_token);
        localStorage.setItem(TOKEN_KEY, data.access_token);
        await queryClient.invalidateQueries();
        return true;
    } catch (error) {
        console.error('Failed to impersonate:', error);
        return false;
    }
}

async function performExitImpersonation(queryClient: ReturnType<typeof useQueryClient>): Promise<boolean> {
    const originalToken = localStorage.getItem(ORIGINAL_TOKEN_KEY);
    if (!originalToken) return false;

    localStorage.setItem(TOKEN_KEY, originalToken);
    localStorage.removeItem(ORIGINAL_TOKEN_KEY);
    await queryClient.invalidateQueries();
    return true;
}

export function useAuth() {
    const queryClient = useQueryClient();

    const { data: user, isLoading, error, refetch } = useQuery({
        queryKey: ['auth', 'me'],
        queryFn: fetchCurrentUser,
        staleTime: 1000 * 60 * 5,
        retry: false,
    });

    const login = useLogin(queryClient);

    const logout = () => {
        // ROK-1353: revoke the refresh family + clear the cookie server-side
        // before dropping local storage. Fire-and-forget — local logout must
        // succeed even if the network call fails.
        void serverLogout();
        clearAllAuthStorage();
        clearSilentGuard();
        clearAuthMethod();
        queryClient.setQueryData(['auth', 'me'], null);
    };

    return {
        user: user ?? null,
        isLoading,
        isAuthenticated: !!user,
        isImpersonating: isImpersonating(),
        error,
        refetch,
        login,
        logout,
        impersonate: (userId: number) => performImpersonation(userId, queryClient),
        exitImpersonation: () => performExitImpersonation(queryClient),
    };
}
