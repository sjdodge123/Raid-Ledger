/**
 * ROK-1662 — the calendar on the ROK-1659 funnel filter standard.
 *
 * - 1024px and up: `CalendarFilterTrigger` (the funnel at the right end of the
 *   calendar toolbar) opens `CalendarFilterEntry`'s inline panel under it.
 * - Below 1024px (phones AND tablets — closes the old 768–1023px gap):
 *   `CalendarFilterEntry` renders the Filters FAB, which opens the BottomSheet.
 *
 * Badge = number of games HIDDEN. "Clear all" shows every game again.
 * Neither renders until the game registry has reported a game.
 */
import type { JSX } from 'react';
import { FilterEntry, FilterEntryTrigger } from '../../components/ui/filter-entry';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { CalendarGameFilterControls } from './CalendarGameFilter';
import type { CalendarGameFilter } from './use-calendar-game-filter';

interface CalendarFilterOpenProps {
    filter: CalendarGameFilter;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

/** The toolbar funnel (1024px and up only). */
export function CalendarFilterTrigger({ filter, isOpen, onOpenChange }: CalendarFilterOpenProps): JSX.Element | null {
    if (filter.allKnownGames.length === 0) return null;
    return <FilterEntryTrigger activeCount={filter.hiddenCount} isOpen={isOpen} onOpenChange={onOpenChange} />;
}

/** Inline panel at 1024px and up; Filters FAB + BottomSheet below. */
export function CalendarFilterEntry({ filter, isOpen, onOpenChange }: CalendarFilterOpenProps): JSX.Element | null {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (filter.allKnownGames.length === 0) return null;
    return (
        <FilterEntry activeCount={filter.hiddenCount} isOpen={isOpen} onOpenChange={onOpenChange}
            onClearAll={filter.selectAllGames}>
            <CalendarGameFilterControls allKnownGames={filter.allKnownGames} selectedGames={filter.selectedGames}
                toggleGame={filter.toggleGame} deselectAllGames={filter.deselectAllGames}
                likedSlugs={filter.likedSlugs} layout={isDesktop ? 'panel' : 'sheet'} />
        </FilterEntry>
    );
}
