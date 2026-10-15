/**
 * Query prefixes whose cached RESPONSE belongs to one viewer and must never be
 * shown to the next one on this browser (ROK-1599, Codex P1).
 *
 * `['calendars']` covers the Calendars overview, which carries the viewer's
 * working subscribe-feed URL — a bearer link. Its key is not viewer-scoped
 * (ROK-1314 `useViewerCacheScope` is the by-construction alternative; the
 * overview's optimistic helpers read it by exact key), so every identity
 * change drops it instead: logout, login, impersonation start and exit.
 */
import type { QueryClient } from '@tanstack/react-query';

const VIEWER_PRIVATE_PREFIXES: readonly (readonly string[])[] = [['calendars']];

/** Remove (not just invalidate) every viewer-private cache entry. */
export function dropViewerPrivateCaches(queryClient: QueryClient): void {
    for (const prefix of VIEWER_PRIVATE_PREFIXES) queryClient.removeQueries({ queryKey: [...prefix] });
}
