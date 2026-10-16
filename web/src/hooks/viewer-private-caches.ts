/**
 * Every identity change empties the query cache except `['auth','me']` (ROK-1811, after
 * ROK-1599's Codex P1). Many cached responses belong to one viewer under keys
 * that are not viewer-scoped — `['notifications', limit, offset]`,
 * `['notifications','unread-count']`, `['me','characters', gameId]`, the
 * Calendars overview with its bearer feed URL — and an allow-list of such
 * prefixes rots the moment a new private query lands. Clearing everything is
 * correct by construction; the price is one refetch of public data.
 *
 * Explicit drops (logout, login, session expiry, impersonation start/exit,
 * cross-tab signals) clear eagerly; `['auth','me']` itself is never removed,
 * and a query a mounted component observes is reset rather than removed.
 * `installViewerPrivateCacheGuard` is the backstop for every other transition: it watches the in-memory access token and clears whenever
 * the token's identity (subject + impersonator) differs from the last one
 * held — a token refresh that ends impersonation, a re-mint after another tab
 * signed in as someone else. A same-identity refresh clears nothing.
 */
import { notifyManager } from '@tanstack/react-query';
import type { Query, QueryClient } from '@tanstack/react-query';
import { getAccessToken, subscribeAccessToken } from '../lib/api/access-token-store';
import { readClaims } from '../lib/api/token-expiry';

const AUTH_ME_KEY = ['auth', 'me'] as const;

/** True for the `['auth','me']` Query itself (not a longer key under it). */
function isAuthMe(query: Query): boolean {
    const key = query.queryKey;
    return key.length === AUTH_ME_KEY.length && key[0] === AUTH_ME_KEY[0] && key[1] === AUTH_ME_KEY[1];
}

const EVERY_QUERY_BUT_AUTH_ME = { predicate: (query: Query) => !isAuthMe(query) };

/**
 * Cancel every query except `['auth','me']`, then RESET the ones a mounted
 * component still observes and REMOVE the rest, and empty the mutation cache,
 * so no response for the previous identity can be read or land afterwards.
 * Reset (not remove) for observed queries is ROK-1811 Codex r2 P1: a subtree
 * that stays mounted across the boundary (a memoized Outlet when impersonation
 * ends) would otherwise keep rendering the previous viewer's data, because a
 * removed Query neither notifies its observers nor can be refetched.
 * When a token is held (the caller swapped it in first) the observed queries
 * refetch as the NEW identity; with none (logout, expiry, a cross-tab
 * hand-off that re-mints later) they sit empty and nothing fires unauthenticated.
 * Cancellation is SILENT: a reverting cancel restores the pre-fetch state on a
 * later tick, which would put the previous viewer's data back on a reset Query.
 * The live `['auth','me']` Query is left in place, never recreated: the mounted
 * `useAuth()` observers stay attached to it, so the caller's re-seed reaches
 * `ProtectedRoute`, and it keeps its own `dataUpdatedAt`.
 * Synchronous on purpose: the callers re-seed `['auth','me']` right after — an
 * awaited gap would let a late response or render land between drop and re-seed.
 */
export function dropViewerPrivateCaches(queryClient: QueryClient): void {
    void queryClient.cancelQueries(EVERY_QUERY_BUT_AUTH_ME, { silent: true });
    const queries = queryClient.getQueryCache().findAll(EVERY_QUERY_BUT_AUTH_ME);
    notifyManager.batch(() => {
        for (const query of queries) {
            if (query.getObserversCount() > 0) query.reset();
            else queryClient.getQueryCache().remove(query);
        }
    });
    queryClient.getMutationCache().clear();
    if (getAccessToken() !== null) {
        void queryClient.refetchQueries({ ...EVERY_QUERY_BUT_AUTH_ME, type: 'active' });
    }
}

function claimText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** `sub:impersonatedBy` of a token, or null when there is none or it is unreadable. */
export function tokenIdentity(token: string | null): string | null {
    const claims = token ? readClaims(token) : null;
    if (!claims) return null;
    return `${claimText(claims.sub)}:${claimText(claims.impersonatedBy)}`;
}

/**
 * Drop the private caches whenever the held token changes identity, then mark
 * `['auth','me']` stale so a mounted `useAuth()` refetches the NEW identity —
 * a guard-only change (a refresh that ends impersonation underneath, a re-mint
 * after another tab signed in) has no caller to re-seed it. A cleared token is
 * ignored (logout drops explicitly), so the next token is compared with the
 * last identity that held one. Returns the uninstaller.
 */
export function installViewerPrivateCacheGuard(queryClient: QueryClient): () => void {
    let lastIdentity = tokenIdentity(getAccessToken());
    return subscribeAccessToken(() => {
        const next = tokenIdentity(getAccessToken());
        if (next === null) return;
        if (lastIdentity !== null && next !== lastIdentity) {
            dropViewerPrivateCaches(queryClient);
            void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY, exact: true });
        }
        lastIdentity = next;
    });
}
