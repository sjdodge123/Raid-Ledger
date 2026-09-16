/**
 * ROK-1525 P2-3 — the one place the games page turns a param edit into a URL.
 *
 * The defect this exists to close: `setSearchParams(updater)` hands the updater
 * the params captured by the CURRENT render (react-router 7 closes over
 * `searchParams`), so two writes issued before React re-renders both start from
 * the same base and the second silently drops the first one's param. That is
 * the ordinary shape of this page — a chip row, a second chip row and the card
 * badges all write, and a user sweeping two chips does it inside one tick.
 *
 * The fix is a module-scoped record of the params most recently WRITTEN or
 * RENDERED, resolved inside the updater instead of the render-scoped copy:
 *
 *   • module-scoped, not a per-hook ref, because the page mounts several
 *     independent instances (`LibraryFilterChips`, `useGamesData`, every card
 *     badge, the `lfg` chip). A per-instance ref fixes a chip racing ITSELF and
 *     still loses a write when two different instances race each other.
 *   • re-synced from the router on every committed location change, so the back
 *     button, an external `navigate()` and a fresh mount all win over whatever
 *     the last write left behind. The cache can therefore never outlive the
 *     location it describes — it only ever bridges the gap between a write and
 *     the render that write causes.
 *
 * Both `use-library-filter-params.ts` and `use-lfg-filter-param.ts` write
 * through here, which is what keeps `players` / `owners` / `genres` / `lfg`
 * from clobbering each other in either direction.
 */
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The query string most recently written or committed, or null before any hook
 * has rendered. Null means "no opinion" — the caller falls back to the params
 * react-router hands the updater.
 */
let latestSearch: string | null = null;

/** Test seam: forget the cached query string (see the module note). */
export function resetLatestSearchParams(): void {
    latestSearch = null;
}

/** Resolve the next params from the latest known state, never from `prev`. */
export type SearchParamResolver = (prev: URLSearchParams) => URLSearchParams;

/**
 * Write search params through the shared latest-params cache.
 *
 * `{ replace: true }` in both directions (ROK-1478 ambiguity A2): a chip row
 * the user sweeps through must not stack history entries that Back then has to
 * unwind one press at a time.
 */
export function useSearchParamWrite(): (resolve: SearchParamResolver) => void {
    const [searchParams, setSearchParams] = useSearchParams();

    // Committed location wins. Syncing in an effect rather than during render
    // keeps a re-render triggered by unrelated state from rolling the cache
    // back to a query string the router has already been told to replace.
    useEffect(() => {
        latestSearch = searchParams.toString();
    }, [searchParams]);

    return useCallback(
        (resolve) =>
            setSearchParams(
                (routerPrev) => {
                    const prev =
                        latestSearch === null ? routerPrev : new URLSearchParams(latestSearch);
                    const next = resolve(prev);
                    latestSearch = next.toString();
                    return next;
                },
                { replace: true },
            ),
        [setSearchParams],
    );
}
