/**
 * The game ids the games page batches want-to-play state for (ROK-1453).
 *
 * `WantToPlayProvider` returns the "not hearted" default for any id missing
 * from its batch, and in `?lfg=1` mode most tiles come from `GET /lfg` and
 * appear in no Discover row — so batching only the Discover/search ids would
 * render every LFG-only tile with an empty heart no matter what the viewer has
 * actually hearted.
 */
import { useMemo } from 'react';
import { useLfgGroups } from '../../hooks/use-lfg-groups';
import { useLfgFilterParam } from './use-lfg-filter-param';

/**
 * Extend the page's tile ids with the LFG group ids while the `lfg=1` view is
 * on. Deduplicated — the batch key is derived from this list.
 *
 * @param discoverIds - Ids from the Discover rows and the search results.
 */
export function useTileGameIds(discoverIds: number[]): number[] {
    const { isLfgOnly } = useLfgFilterParam();
    const { data } = useLfgGroups();

    return useMemo(() => {
        if (!isLfgOnly) return discoverIds;
        const merged = new Set(discoverIds);
        for (const group of data ?? []) merged.add(group.gameId);
        return [...merged];
    }, [isLfgOnly, discoverIds, data]);
}
