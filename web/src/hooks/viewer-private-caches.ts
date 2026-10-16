/**
 * Every identity change empties the query cache except `['auth','me']` and the
 * token-less public queries in `VIEWER_INDEPENDENT_PREFIXES` (ROK-1811, after
 * ROK-1599's Codex P1). Many cached responses belong to one viewer under keys
 * that are not viewer-scoped — `['notifications', limit, offset]`,
 * `['notifications','unread-count']`, `['me','characters', gameId]`, the
 * Calendars overview with its bearer feed URL — and an allow-list of such
 * prefixes rots the moment a new private query lands. Clearing everything is
 * correct by construction; the price is one refetch of public data.
 *
 * Explicit drops (logout, login, session expiry, impersonation start/exit,
 * cross-tab signals) clear eagerly; `['auth','me']` itself is never removed,
 * and a query a mounted component observes is reset rather than removed. A
 * reset query a mounted component was fetching is fetched again as soon as a
 * token is held — at the drop, or when the next token arrives — whatever its
 * `enabled` says by then (Codex r4 P2a).
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

/**
 * Key prefixes of queries whose fetcher never sends the viewer's token or
 * cookies, so the response is the same for every viewer and holds nothing to
 * drop (ROK-1811 Codex r3 P2). They are left untouched — reset, they would sit
 * pending after a logout because nothing refetches without a token, and the
 * public lineup page would read that as "no longer available". The ONLY place
 * this list lives; forgetting an entry costs a refetch, never a leak.
 */
const VIEWER_INDEPENDENT_PREFIXES: readonly (readonly string[])[] = [
    ['lineups', 'public'], // getPublicLineup — raw fetch, no bearer, no credentials
    ['system', 'status'], // getSystemStatus — raw fetch, no bearer; unguarded, viewer-free route (Codex r4 P2b)
];

/** True when the query's key starts with a viewer-independent prefix. */
function isViewerIndependent(query: Query): boolean {
    const key = query.queryKey;
    return VIEWER_INDEPENDENT_PREFIXES.some((prefix) => prefix.every((part, i) => key[i] === part));
}

const VIEWER_PRIVATE_QUERIES = {
    predicate: (query: Query) => !isAuthMe(query) && !isViewerIndependent(query),
};

/**
 * Per client: queries a drop reset while a mounted component was actively
 * fetching them, not yet fetched again (Codex r4 P2a). A hook that reads the
 * token at render without subscribing to it (`useCalendarsOverview`)
 * re-renders DISABLED after a token-less reset and never re-renders when the
 * token comes back, so `refetchQueries`/`invalidateQueries` (both skip
 * disabled queries) would leave it empty. Remembering "was active before the
 * drop" — rather than reading `enabled` afterwards — is correct by
 * construction for every such hook, current or future.
 */
const strandedByClient = new WeakMap<QueryClient, Set<Query>>();

function strandedFor(queryClient: QueryClient): Set<Query> {
    const existing = strandedByClient.get(queryClient);
    if (existing) return existing;
    const created = new Set<Query>();
    strandedByClient.set(queryClient, created);
    return created;
}

/**
 * Fetch every stranded query a mounted component still observes, ignoring
 * `enabled` (`query.fetch()` does not consult it): the response re-renders the
 * hook, which then re-reads the token and re-enables itself. Only called with
 * a token held, so nothing fires unauthenticated. Unobserved or evicted
 * queries are dropped from the set without a fetch.
 */
function resumeStranded(queryClient: QueryClient): void {
    const stranded = strandedByClient.get(queryClient);
    if (!stranded || stranded.size === 0) return;
    const cache = queryClient.getQueryCache();
    const queries = [...stranded];
    stranded.clear();
    for (const query of queries) {
        if (query.getObserversCount() > 0 && cache.get(query.queryHash) === query) {
            query.fetch().catch(() => undefined);
        }
    }
}

/**
 * Cancel every query except `['auth','me']` and the viewer-independent public
 * ones, then RESET the ones a mounted
 * component still observes and REMOVE the rest, and empty the mutation cache,
 * so no response for the previous identity can be read or land afterwards.
 * Reset (not remove) for observed queries is ROK-1811 Codex r2 P1: a subtree
 * that stays mounted across the boundary (a memoized Outlet when impersonation
 * ends) would otherwise keep rendering the previous viewer's data, because a
 * removed Query neither notifies its observers nor can be refetched.
 * When a token is held (the caller swapped it in first) the ones that were
 * active — plus any stranded by an earlier token-less drop — refetch as the
 * NEW identity; with none (logout, expiry, a cross-tab hand-off that re-mints
 * later) they sit empty, nothing fires unauthenticated, and the guard fetches
 * them when the next token arrives.
 * Cancellation is SILENT: a reverting cancel restores the pre-fetch state on a
 * later tick, which would put the previous viewer's data back on a reset Query.
 * The live `['auth','me']` Query is left in place, never recreated: the mounted
 * `useAuth()` observers stay attached to it, so the caller's re-seed reaches
 * `ProtectedRoute`, and it keeps its own `dataUpdatedAt`.
 * Synchronous on purpose: the callers re-seed `['auth','me']` right after — an
 * awaited gap would let a late response or render land between drop and re-seed.
 */
export function dropViewerPrivateCaches(queryClient: QueryClient): void {
    void queryClient.cancelQueries(VIEWER_PRIVATE_QUERIES, { silent: true });
    const queries = queryClient.getQueryCache().findAll(VIEWER_PRIVATE_QUERIES);
    const stranded = strandedFor(queryClient);
    notifyManager.batch(() => {
        for (const query of queries) {
            if (query.getObserversCount() === 0) {
                queryClient.getQueryCache().remove(query);
                continue;
            }
            if (query.isActive()) stranded.add(query);
            query.reset();
        }
    });
    queryClient.getMutationCache().clear();
    if (getAccessToken() !== null) resumeStranded(queryClient);
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
 * last identity that held one. A token for the SAME identity (a cross-tab
 * re-mint after a token-less drop) fetches the stranded queries instead of
 * dropping again; with none stranded it does nothing. Returns the uninstaller.
 */
export function installViewerPrivateCacheGuard(queryClient: QueryClient): () => void {
    let lastIdentity = tokenIdentity(getAccessToken());
    return subscribeAccessToken(() => {
        const next = tokenIdentity(getAccessToken());
        if (next === null) return;
        if (lastIdentity !== null && next !== lastIdentity) {
            dropViewerPrivateCaches(queryClient);
            void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY, exact: true });
        } else {
            resumeStranded(queryClient);
        }
        lastIdentity = next;
    });
}
