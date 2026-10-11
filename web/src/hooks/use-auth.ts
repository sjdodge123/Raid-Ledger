import { useCallback, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import { ensureFreshToken, refreshWithOutcome } from '../lib/api/refresh-client';
import { clearSilentGuard, clearAuthMethod, getAuthMethod, attemptSilentReauth } from '../lib/api/silent-reauth';
import { USER_CACHE_KEY } from '../lib/api/auth-storage-keys';
import {
    clearAccessToken, getAccessToken, isImpersonatingToken, setAccessToken, subscribeAccessToken,
} from '../lib/api/access-token-store';
import { readClaims } from '../lib/api/token-expiry';
import { toast } from '../lib/toast';
import { endDeactivatedSession, isDeactivatedResponse } from '../lib/api/deactivated-session';
import { awaitMagicLinkRedeem } from '../lib/magic-link-redeem';
import { bumpIdentityEpoch } from '../lib/api/cross-tab-auth';
import type { UserRole } from '@raid-ledger/contract';

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
    avatarPreference?: { type: 'custom' | 'discord' | 'character'; characterName?: string | undefined } | null;
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

/** The in-memory access token (ROK-1754: never in storage). */
export function getAuthToken(): string | null {
    return getAccessToken();
}

/** Hold an auth token in memory. No React Query invalidation — use login(). */
export function setAuthToken(token: string): void {
    setAccessToken(token);
}

/** Impersonating = the in-memory token carries `impersonatedBy` (ROK-1754). */
export function isImpersonating(): boolean {
    return isImpersonatingToken();
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
    clearAccessToken();
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
    // ROK-1366: a magic-link exchange started at module load may still be in
    // flight — decide only once it has settled, so a deep link lands signed in.
    await awaitMagicLinkRedeem();
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
    // ROK-1753: a deactivated account is terminal — don't spend a refresh on it.
    if (await isDeactivatedResponse(response)) {
        endDeactivatedSession();
        return null;
    }

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
        setAccessToken(token);
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

/**
 * ROK-1754 §3.3: bump the identity epoch so every other tab clears its
 * in-memory token and re-mints from the shared cookie as the new identity.
 */
function signalIdentityChange(): void {
    bumpIdentityEpoch();
}

/**
 * ROK-1754 end detection: a token without `impersonatedBy` replacing one that
 * carried it (a refresh after the cap, a banned target, a demoted admin, a
 * stop in another tab) means impersonation ended underneath us. A voluntary
 * exit clears memory first, so it never trips this.
 */
let heldImpersonation = isImpersonatingToken();
subscribeAccessToken(() => {
    const next = getAccessToken();
    const nowImpersonating = isImpersonatingToken(next);
    if (heldImpersonation && next !== null && !nowImpersonating) toast.info('Impersonation ended');
    heldImpersonation = nowImpersonating;
});

/** Seconds-epoch `exp` of the held token, or null. Used by the banner. */
export function heldTokenExpiry(): number | null {
    const token = getAccessToken();
    const exp = token ? readClaims(token)?.exp : undefined;
    return typeof exp === 'number' ? exp : null;
}

/** Start: the server writes the family marker (cookie); the token is memory-only. */
async function performImpersonation(userId: number, queryClient: ReturnType<typeof useQueryClient>): Promise<boolean> {
    const token = getAuthToken();
    if (!token) return false;
    try {
        const response = await fetch(`${API_BASE_URL}/auth/impersonate/${userId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { access_token: string } = await response.json();
        setAccessToken(data.access_token);
        signalIdentityChange();
        await queryClient.invalidateQueries();
        return true;
    } catch (error) {
        console.error('Failed to impersonate:', error);
        return false;
    }
}

/** POST the cookie-authenticated exit; true only when the server confirmed it. */
async function postExitImpersonation(): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE_URL}/auth/impersonate/exit`, { method: 'POST', credentials: 'include' });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Stop: end the server marker FIRST — a refresh while it is live re-mints the
 * impersonation — then re-mint the admin token from the cookie. A failed exit
 * keeps the impersonation token (and the banner) and never refreshes.
 */
async function performExitImpersonation(queryClient: ReturnType<typeof useQueryClient>): Promise<boolean> {
    if (!(await postExitImpersonation())) {
        toast.error('Could not exit impersonation. Check your connection and try again.');
        return false;
    }
    clearAccessToken();
    const outcome = await refreshWithOutcome();
    if (outcome.kind === 'rejected') {
        clearAllAuthStorage();
        queryClient.setQueryData(['auth', 'me'], null);
        return false;
    }
    signalIdentityChange();
    await queryClient.invalidateQueries();
    return outcome.kind === 'ok';
}

/**
 * ROK-1314: cache scope for any query whose RESPONSE varies by viewer.
 *
 * The `/games` discover, search and detail responses used to be identical for
 * everyone, so a shared React Query key was correct. They now carry
 * `currentUserOwns` / `currentUserWishlisted`, which makes a shared key a
 * cross-viewer leak: `logout()` only resets `['auth','me']`, so the previous
 * user's personalized payload stayed cached and the next anonymous viewer on
 * that browser saw their `You own` badges until the stale window expired.
 *
 * Scoping the KEY is deliberate over invalidating on logout: it is correct by
 * construction and cannot be defeated by a future auth transition that forgets
 * to invalidate (impersonate, exit-impersonate, token refresh, session expiry).
 * Found by the Codex security pass on this branch.
 */
export function useViewerCacheScope(): number | 'anon' {
    const { user } = useAuth();
    return user?.id ?? 'anon';
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
    const impersonating = useSyncExternalStore(subscribeAccessToken, isImpersonating);

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
        isImpersonating: impersonating,
        error,
        refetch,
        login,
        logout,
        impersonate: (userId: number) => performImpersonation(userId, queryClient),
        exitImpersonation: () => performExitImpersonation(queryClient),
    };
}
