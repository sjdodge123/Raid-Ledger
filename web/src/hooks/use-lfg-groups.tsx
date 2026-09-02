/**
 * LFG group reads (ROK-1453).
 *
 * `GET /lfg` already returns every game with a live intent, so ONE request
 * serves a whole page of tiles (spec decision D1 — no per-tile fetch, no
 * `counts?ids=` endpoint). `LfgGroupsProvider` turns that list into an
 * id → group lookup for `useLfgGroup`; surfaces that only need the list (the
 * events banner, the `lfg=1` filter) call `useLfgGroups` directly and share
 * the same query key, so react-query still issues a single request.
 */
import { useMemo, type ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
    LfgGroupDetailDto,
    LfgGroupSummaryDto,
} from '@raid-ledger/contract';
import { getLfgGroup, getLfgGroups } from '../lib/api/lfg-api';
import { ACCESS_TOKEN_KEY } from '../lib/api/auth-storage-keys';
import {
    LfgGroupsContext,
    type LfgGroupsContextValue,
} from './lfg-groups-context';

/** Shared query key — every LFG-group consumer must use this exact key. */
export const LFG_GROUPS_QUERY_KEY = ['lfg', 'groups'] as const;

/**
 * The raw `GET /lfg` list. Disabled while logged out (the route is jwt-gated).
 */
export function useLfgGroups(): UseQueryResult<LfgGroupSummaryDto[]> {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
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
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    return useQuery<LfgGroupDetailDto>({
        queryKey: ['lfg', 'group', gameId],
        queryFn: () => getLfgGroup(gameId as number),
        enabled: !!token && !!gameId,
        staleTime: 1000 * 60,
    });
}

/**
 * Provide the page-level LFG lookup to every tile beneath it.
 *
 * @param children - Subtree whose `useLfgGroup` calls resolve against the list.
 */
export function LfgGroupsProvider({ children }: { children: ReactNode }) {
    const { data } = useLfgGroups();

    const value = useMemo<LfgGroupsContextValue>(() => {
        const byId = new Map<number, LfgGroupSummaryDto>(
            (data ?? []).map((group) => [group.gameId, group]),
        );
        return { getGroup: (gameId: number) => byId.get(gameId) };
    }, [data]);

    return (
        <LfgGroupsContext.Provider value={value}>
            {children}
        </LfgGroupsContext.Provider>
    );
}
