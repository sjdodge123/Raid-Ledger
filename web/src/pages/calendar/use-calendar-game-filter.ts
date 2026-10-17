/** ROK-1662 — the calendar's game filter state + the Filters badge count. */
import { useLikedGameSlugs } from '../../hooks/use-liked-game-slugs';
import { useGameFilterStore, type GameInfo } from '../../stores/game-filter-store';
import { countHiddenGames } from './game-filter-helpers';

export interface CalendarGameFilter {
    allKnownGames: GameInfo[];
    selectedGames: Set<string>;
    toggleGame: (slug: string) => void;
    selectAllGames: () => void;
    deselectAllGames: () => void;
    likedSlugs: Set<string>;
    /** Known games filtered out — the Filters badge. */
    hiddenCount: number;
}

/** The calendar's game filter state, read from the persisted game-filter store. */
export function useCalendarGameFilter(): CalendarGameFilter {
    const allKnownGames = useGameFilterStore((s) => s.allKnownGames);
    const selectedGames = useGameFilterStore((s) => s.selectedGames);
    const toggleGame = useGameFilterStore((s) => s.toggleGame);
    const selectAllGames = useGameFilterStore((s) => s.selectAll);
    const deselectAllGames = useGameFilterStore((s) => s.deselectAll);
    const likedSlugs = useLikedGameSlugs();
    const hiddenCount = countHiddenGames(allKnownGames, selectedGames);
    return { allKnownGames, selectedGames, toggleGame, selectAllGames, deselectAllGames, likedSlugs, hiddenCount };
}
