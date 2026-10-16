/**
 * Query prefixes whose cached RESPONSE belongs to one viewer and must never be
 * shown to the next one on this browser (ROK-1599, Codex P1).
 *
 * `['calendars']` covers the Calendars overview, which carries the viewer's
 * working subscribe-feed URL — a bearer link. Its key is not viewer-scoped
 * (ROK-1314 `useViewerCacheScope` is the by-construction alternative; the
 * overview's optimistic helpers read it by exact key), so every identity
 * change drops it instead.
 *
 * Explicit drops (logout, login, impersonation start/exit, cross-tab signals)
 * clear it eagerly. `installViewerPrivateCacheGuard` is the backstop for every
 * other transition: it watches the in-memory access token and drops the caches
 * whenever the token's identity (subject + impersonator) differs from the last
 * one held — a token refresh that ends impersonation, a re-mint after another
 * tab signed in as someone else. A same-identity refresh drops nothing.
 */
import type { QueryClient } from '@tanstack/react-query';
import { getAccessToken, subscribeAccessToken } from '../lib/api/access-token-store';
import { readClaims } from '../lib/api/token-expiry';

const VIEWER_PRIVATE_PREFIXES: readonly (readonly string[])[] = [['calendars']];

/** Remove (not just invalidate) every viewer-private cache entry. */
export function dropViewerPrivateCaches(queryClient: QueryClient): void {
    for (const prefix of VIEWER_PRIVATE_PREFIXES) queryClient.removeQueries({ queryKey: [...prefix] });
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
 * Drop viewer-private caches whenever the held token changes identity. A
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
