import type { QueryClient } from '@tanstack/react-query';
import { ensureFreshToken } from './refresh-client';
import { getAccessToken } from './access-token-store';
import { getAuthMethod } from './silent-reauth';
import { isTokenStale } from './token-expiry';
import { httpStatusOf } from './api-error';

/**
 * ROK-1947: a backgrounded phone tab keeps its in-memory access token
 * (ROK-1754) while its timers sleep, so it wakes holding an expired one. On
 * resume — the tab turns visible again, or the page comes back from the
 * bfcache — refresh it up front through the shared single-flight entry point,
 * so the next request does not depend on the 401 backstop. Once a token lands,
 * any query that already failed with a 401 is refetched.
 */
export async function refreshIfStaleOnResume(queryClient: QueryClient): Promise<void> {
    if (!getAuthMethod() || !isTokenStale(getAccessToken())) return;
    const token = await ensureFreshToken();
    if (!token) return;
    await queryClient.refetchQueries({ predicate: (query) => httpStatusOf(query.state.error) === 401 });
}

/** Install once per page (App.tsx). Returns the uninstaller (tests). */
export function installResumeRefresh(queryClient: QueryClient): () => void {
    const onVisibility = (): void => {
        if (document.visibilityState === 'visible') void refreshIfStaleOnResume(queryClient);
    };
    const onPageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) void refreshIfStaleOnResume(queryClient);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pageshow', onPageShow);
    };
}
