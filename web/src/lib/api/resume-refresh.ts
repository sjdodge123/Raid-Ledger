import type { Query, QueryClient } from '@tanstack/react-query';
import { ensureFreshToken, onRefreshSuccess } from './refresh-client';
import { getAccessToken } from './access-token-store';
import { getAuthMethod } from './silent-reauth';
import { isTokenStale } from './token-expiry';
import { httpStatusOf } from './api-error';

/**
 * ROK-1947: a backgrounded phone tab keeps its in-memory access token
 * (ROK-1754) while its timers sleep, so it wakes holding an expired one. On
 * resume — the tab turns visible again, the page comes back from the bfcache,
 * or the network comes back — refresh it through the shared single-flight
 * entry point. After ANY refresh that installs a token (this one, the
 * pre-request refresh in `fetchWithAuth`, or the 401 backstop), every active
 * query that already failed with a 401 is refetched.
 */
export function refreshIfStale(): void {
    if (!getAuthMethod() || !isTokenStale(getAccessToken())) return;
    void ensureFreshToken();
}

/**
 * An idle query whose last error was a 401. A query already fetching is left
 * alone: its own request holds the new token, and restarting it from here
 * could loop when its 401 backstop refresh notifies again.
 */
function failedUnauthorized(query: Query): boolean {
    return query.state.fetchStatus === 'idle' && httpStatusOf(query.state.error) === 401;
}

/** Refetch the active queries a stale token failed with a 401. */
export function refetchUnauthorized(queryClient: QueryClient): Promise<void> {
    return queryClient.refetchQueries({ type: 'active', predicate: failedUnauthorized }, { cancelRefetch: false });
}

/**
 * How long one refetch batch may hold the guard. A refetch that never settles
 * (a request the network swallowed) would otherwise keep it forever and drop
 * every later refresh notification.
 */
export const REFETCH_BATCH_TIMEOUT_MS = 15_000;

/** Settle when `work` does or after `ms`, whichever is first; the timer is always cleared. */
function settleWithin(work: Promise<void>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Refetch the 401'd queries after a refresh, one batch at a time. A batch's own
 * refetches can refresh again (the 401 backstop in `fetchWithAuth`); those
 * notifications are dropped, or two queries that still 401 would restart each
 * other forever. A batch ends when its refetches settle or after `timeoutMs`,
 * so the guard always resets. Exported for its spec; the app uses
 * `installResumeRefresh`.
 */
export function batchedRefetch(queryClient: QueryClient, timeoutMs: number = REFETCH_BATCH_TIMEOUT_MS): () => void {
    let running = false;
    return () => {
        if (running) return;
        running = true;
        void settleWithin(refetchUnauthorized(queryClient), timeoutMs).finally(() => { running = false; });
    };
}

/** Install once per mounted app (App.tsx effect). Returns the uninstaller. */
export function installResumeRefresh(queryClient: QueryClient): () => void {
    const onVisibility = (): void => {
        if (document.visibilityState === 'visible') refreshIfStale();
    };
    const onPageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) refreshIfStale();
    };
    const unsubscribe = onRefreshSuccess(batchedRefetch(queryClient));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', refreshIfStale);
    return () => {
        unsubscribe();
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('online', refreshIfStale);
    };
}
