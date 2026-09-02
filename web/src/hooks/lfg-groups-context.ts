/**
 * Context for the page-level LFG group lookup (ROK-1453 D1).
 *
 * Lives apart from `use-lfg-groups.tsx` for the same reason
 * `want-to-play-context.ts` does: a module that exports both a component and
 * plain values breaks Fast Refresh.
 */
import { createContext, useContext } from 'react';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';

export interface LfgGroupsContextValue {
    /** The group for a game, or `undefined` when nobody is looking. */
    getGroup: (gameId: number) => LfgGroupSummaryDto | undefined;
}

/**
 * `undefined` (not a default value) so consumers can tell "no provider on this
 * page" apart from "provider present, this game has no group" — both render no
 * chip, but only the former must avoid throwing.
 */
export const LfgGroupsContext = createContext<
    LfgGroupsContextValue | undefined
>(undefined);

/**
 * The LFG group for one game, from the single page-level `GET /lfg`.
 *
 * Returns `undefined` when the game has no live intents AND when the component
 * renders outside `LfgGroupsProvider` — tiles are shared across pages that
 * never mount the provider, so a missing provider is a no-chip, not a crash.
 *
 * @param gameId - Game whose group to look up.
 */
export function useLfgGroup(gameId: number): LfgGroupSummaryDto | undefined {
    const ctx = useContext(LfgGroupsContext);
    return ctx?.getGroup(gameId);
}
