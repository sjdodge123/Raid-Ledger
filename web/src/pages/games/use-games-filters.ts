/**
 * ROK-1659 — the /games filter entry's two page-level hooks: the badge count
 * and "Clear all". Split from `games-filter-panel.tsx` so that file only
 * exports components (react-refresh).
 */
import { useCallback } from 'react';
import { EMPTY_COOP_FILTERS, countActiveCoopFilters, type CoopFilterState } from './coop-filter.helpers';
import { useLfgFilterParam } from './use-lfg-filter-param';
import { useLibraryFilterParams } from './use-library-filter-params';
import { useSearchParamWrite } from './use-search-param-write';

/** Every URL param the panel owns — `q` (the search box) is deliberately not one. */
const FILTER_PARAMS = ['lfg', 'players', 'owners', 'genres'] as const;

/**
 * Active filters for the badge: LFG, players, owners (1 each), one per selected
 * genre, plus the co-op predicates the page is actually applying (a dormant
 * page passes `EMPTY_COOP_FILTERS`, so a restored-but-hidden filter never counts).
 * A paused filter never counts, whatever paused it: genres drop out while
 * searching (search skips them, the group is greyed out), and LFG on counts
 * alone (the LFG view ignores players/owners/genres/co-op and the panel
 * disables them), so the badge only counts what is narrowing the view.
 */
export function useGamesFilterCount(effectiveCoopFilters: CoopFilterState, isSearching: boolean): number {
    const { isLfgOnly } = useLfgFilterParam();
    const { playersFilter, minOwners, selectedGenres } = useLibraryFilterParams();
    if (isLfgOnly) return 1;
    return (playersFilter !== null ? 1 : 0) + (minOwners !== null ? 1 : 0)
        + (isSearching ? 0 : selectedGenres.size) + countActiveCoopFilters(effectiveCoopFilters);
}

/** "Clear all": drops every filter param in ONE URL write (leaving `q`) and resets co-op. */
export function useClearAllGamesFilters(onCoopFiltersChange: (next: CoopFilterState) => void): () => void {
    const write = useSearchParamWrite();
    return useCallback(() => {
        write((prev) => {
            const next = new URLSearchParams(prev);
            for (const key of FILTER_PARAMS) next.delete(key);
            return next;
        });
        onCoopFiltersChange(EMPTY_COOP_FILTERS);
    }, [write, onCoopFiltersChange]);
}
