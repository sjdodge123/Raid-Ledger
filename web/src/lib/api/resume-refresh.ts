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

/** Install once per mounted app (App.tsx effect). Returns the uninstaller. */
export function installResumeRefresh(queryClient: QueryClient): () => void {
    const onVisibility = (): void => {
        if (document.visibilityState === 'visible') refreshIfStale();
    };
    const onPageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) refreshIfStale();
    };
    const unsubscribe = onRefreshSuccess(() => void refetchUnauthorized(queryClient));
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
