/**
 * ROK-1662 — the calendar on the ROK-1659 funnel filter standard.
 *
 * - 1024px and up: `CalendarFilterTrigger` (the funnel at the right end of the
 *   calendar toolbar) opens `CalendarFilterEntry`'s inline panel under it.
 * - Below 1024px (phones AND tablets — closes the old 768–1023px gap):
 *   `CalendarFilterEntry` renders the Filters FAB, which opens the BottomSheet.
 *
 * Badge = number of games HIDDEN plus calendar layers switched off (ROK-1775).
 * "Clear all" shows every game and every layer again. Neither renders until
 * there is something to filter: a known game or a togglable calendar layer.
 */
import type { JSX } from 'react';
import { FilterEntry, FilterEntryTrigger } from '../../components/ui/filter-entry';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { CalendarGameFilterControls } from './CalendarGameFilter';
import { CalendarLayerToggleList } from './CalendarLayerToggleList';
import type { CalendarGameFilter } from './use-calendar-game-filter';
import type { CalendarLayerToggles } from './use-calendar-layer-toggles';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The calendar badge counts hidden things, not filters — say what is hidden to assistive tech. */
function describeHidden(filter: CalendarGameFilter, layers: CalendarLayerToggles): () => string {
    return () => {
        const parts: string[] = [];
        if (filter.hiddenCount > 0) parts.push(plural(filter.hiddenCount, 'game', 'games'));
        if (layers.hiddenCount > 0) parts.push(plural(layers.hiddenCount, 'calendar layer', 'calendar layers'));
        return `${parts.join(' and ')} hidden`;
    };
}

interface CalendarFilterOpenProps {
    filter: CalendarGameFilter;
    layers: CalendarLayerToggles;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

const hasNothingToFilter = (filter: CalendarGameFilter, layers: CalendarLayerToggles): boolean =>
    filter.allKnownGames.length === 0 && layers.toggles.length === 0;

const activeCountOf = (filter: CalendarGameFilter, layers: CalendarLayerToggles): number =>
    filter.hiddenCount + layers.hiddenCount;

/** The toolbar funnel (1024px and up only). */
export function CalendarFilterTrigger({ filter, layers, isOpen, onOpenChange }: CalendarFilterOpenProps): JSX.Element | null {
    if (hasNothingToFilter(filter, layers)) return null;
    return (
        <FilterEntryTrigger activeCount={activeCountOf(filter, layers)} isOpen={isOpen} onOpenChange={onOpenChange}
            describeCount={describeHidden(filter, layers)} />
    );
}

/** Inline panel at 1024px and up; Filters FAB + BottomSheet below. */
export function CalendarFilterEntry({ filter, layers, isOpen, onOpenChange }: CalendarFilterOpenProps): JSX.Element | null {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (hasNothingToFilter(filter, layers)) return null;
    const clearAll = (): void => { filter.selectAllGames(); layers.showAllLayers(); };
    return (
        <FilterEntry activeCount={activeCountOf(filter, layers)} isOpen={isOpen} onOpenChange={onOpenChange}
            onClearAll={clearAll} describeCount={describeHidden(filter, layers)}>
            <div className="space-y-4">
                {filter.allKnownGames.length > 0 && (
                    <CalendarGameFilterControls allKnownGames={filter.allKnownGames} selectedGames={filter.selectedGames}
                        toggleGame={filter.toggleGame} deselectAllGames={filter.deselectAllGames}
                        likedSlugs={filter.likedSlugs} layout={isDesktop ? 'panel' : 'sheet'} />
                )}
                <CalendarLayerToggleList layers={layers} />
            </div>
        </FilterEntry>
    );
}
