/**
 * LFG group reads (ROK-1453).
 *
 * `GET /lfg` already returns every game with a live intent, so ONE request
 * serves a whole page of tiles (spec decision D1 — no per-tile fetch, no
 * `counts?ids=` endpoint). `LfgGroupsProvider` (`lfg-groups-provider.tsx`)
 * turns that list into an id → group lookup for `useLfgGroup`; surfaces that
 * only need the list (the events banner, the `lfg=1` filter) call
 * `useLfgGroups` directly and share the same query key, so react-query still
 * issues a single request no matter how many consumers mount.
 *
 * Hooks only — the provider component lives in its own file because a module
 * exporting BOTH a component and plain functions breaks Fast Refresh
 * (`react-refresh/only-export-components` is an error in this workspace).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
    LfgGroupDetailDto,
    LfgGroupSummaryDto,
} from '@raid-ledger/contract';
import { getLfgGroup, getLfgGroups } from '../lib/api/lfg-api';
import { getAuthToken } from './use-auth';

/** Shared query key — every LFG-group consumer must use this exact key. */
export const LFG_GROUPS_QUERY_KEY = ['lfg', 'groups'] as const;

/**
 * The raw `GET /lfg` list. Disabled while logged out (the route is jwt-gated).
 */
export function useLfgGroups(): UseQueryResult<LfgGroupSummaryDto[]> {
    const token = getAuthToken();
    return useQuery<LfgGroupSummaryDto[]>({
        queryKey: LFG_GROUPS_QUERY_KEY,
        queryFn: getLfgGroups,
        enabled: !!token,
        staleTime: 1000 * 60,
    });
}

/**
 * One game's group — for surfaces that render a single game (the detail page)
 * and would gain nothing from the whole list.
 *
 * @param gameId - Game to read, or `undefined` while the route param resolves.
 */
export function useLfgGroupDetail(
    gameId: number | undefined,
): UseQueryResult<LfgGroupDetailDto> {
    const token = getAuthToken();
    return useQuery<LfgGroupDetailDto>({
        queryKey: ['lfg', 'group', gameId],
        queryFn: () => getLfgGroup(gameId as number),
        enabled: !!token && !!gameId,
        staleTime: 1000 * 60,
    });
}
