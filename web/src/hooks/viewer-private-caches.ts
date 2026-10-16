/**
 * Every identity change empties the WHOLE query cache (ROK-1811, after
 * ROK-1599's Codex P1). Many cached responses belong to one viewer under keys
 * that are not viewer-scoped — `['notifications', limit, offset]`,
 * `['notifications','unread-count']`, `['me','characters', gameId]`, the
 * Calendars overview with its bearer feed URL — and an allow-list of such
 * prefixes rots the moment a new private query lands. Clearing everything is
 * correct by construction; the price is one refetch of public data.
 *
 * Explicit drops (logout, login, impersonation start/exit, cross-tab signals)
 * clear eagerly. `installViewerPrivateCacheGuard` is the backstop for every
 * other transition: it watches the in-memory access token and clears whenever
 * the token's identity (subject + impersonator) differs from the last one
 * held — a token refresh that ends impersonation, a re-mint after another tab
 * signed in as someone else. A same-identity refresh clears nothing.
 */
import type { QueryClient } from '@tanstack/react-query';
import { getAccessToken, subscribeAccessToken } from '../lib/api/access-token-store';
import { readClaims } from '../lib/api/token-expiry';

const AUTH_ME_KEY = ['auth', 'me'] as const;

/**
 * Cancel every in-flight fetch, then empty the query AND mutation caches, so
 * no response for the previous identity can be read or land afterwards.
 * Synchronous on purpose: `cancelQueries` rejects each fetch immediately (and
 * `clear()` silently cancels whatever is left), and the callers re-seed
 * `['auth','me']` right after — an awaited gap would let a render observe the
 * empty seed and route to /login, or a late `clear()` wipe the new seed.
 * `['auth','me']` is carried across the clear so a caller that does not
 * re-seed it (impersonation, the token guard) never flashes a signed-out
 * state; callers that know the new identity overwrite it next.
 */
export function dropViewerPrivateCaches(queryClient: QueryClient): void {
    const me: unknown = queryClient.getQueryData(AUTH_ME_KEY);
    void queryClient.cancelQueries();
    queryClient.clear();
    if (me !== undefined) queryClient.setQueryData(AUTH_ME_KEY, me);
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
 * Clear the query cache whenever the held token changes identity. A
 * cleared token is ignored (logout drops explicitly), so the next token is
 * compared with the last identity that held one. Returns the uninstaller.
 */
export function installViewerPrivateCacheGuard(queryClient: QueryClient): () => void {
    let lastIdentity = tokenIdentity(getAccessToken());
    return subscribeAccessToken(() => {
        const next = tokenIdentity(getAccessToken());
        if (next === null) return;
        if (lastIdentity !== null && next !== lastIdentity) dropViewerPrivateCaches(queryClient);
        lastIdentity = next;
    });
}
