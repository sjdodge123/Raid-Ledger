/**
 * ROK-1659 — the muted "N games" label beside the /games filter entry: how many
 * games the grid shows right now, after every filter (prototype GamesDesktop /
 * GamesPhone artboards).
 */
import type { GameDetailDto, GameDiscoverRowDto } from '@raid-ledger/contract';

export interface GamesResultCountInput {
    isLfgOnly: boolean;
    isSearching: boolean;
    searchLoading: boolean;
    discoverLoading: boolean;
    filteredRows: GameDiscoverRowDto[] | undefined;
    searchResults: GameDetailDto[] | undefined;
}

/**
 * `null` hides the label: the LFG view lists groups, not games, and a count
 * before the data lands would be wrong. Discover carousels overlap (one game
 * can sit in several rows), so their ids are de-duplicated.
 */
export function gamesResultCount(input: GamesResultCountInput): number | null {
    if (input.isLfgOnly) return null;
    if (input.isSearching) {
        return input.searchLoading || !input.searchResults ? null : input.searchResults.length;
    }
    if (input.discoverLoading || !input.filteredRows) return null;
    return new Set(input.filteredRows.flatMap((row) => row.games.map((game) => game.id))).size;
}

/** "1 game" / "N games". */
export const formatGamesCount = (count: number): string => `${count} ${count === 1 ? 'game' : 'games'}`;
