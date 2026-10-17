/**
 * The page-level LFG group provider (ROK-1453 D1).
 *
 * Separate module from the hooks it uses: `react-refresh/only-export-components`
 * forbids a file from exporting a component alongside plain functions.
 */
import { useMemo, type ReactNode } from 'react';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import { useLfgGroups } from './use-lfg-groups';
import {
    LfgGroupsContext,
    type LfgGroupsContextValue,
} from './lfg-groups-context';

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
