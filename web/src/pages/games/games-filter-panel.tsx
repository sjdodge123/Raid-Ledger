/**
 * ROK-1659 — THE /games filter entry: one `FilterEntry` (toolbar funnel +
 * inline panel at 1024px and up, Filters FAB + BottomSheet below) holding the
 * whole set — LFG, players, owners, genres and, once Co-Optimus data exists,
 * co-op. The badge counts active filters, not results.
 */
import type { JSX } from 'react';
import { FilterEntry } from '../../components/ui/filter-entry';
import { CoopFilterControls } from './coop-filter-controls';
import { countActiveCoopFilters, type CoopFilterState } from './coop-filter.helpers';
import {
    FilterFieldGroup, GenresField, LfgField, LibraryFilterHint, OwnersField, PlayersField,
} from './games-filter-fields';
import { useLfgFilterParam } from './use-lfg-filter-param';
import { useLibraryFilterParams } from './use-library-filter-params';
import { useClearAllGamesFilters } from './use-games-filters';

export interface GamesFilterPanelProps {
    activeCount: number;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    isSearching: boolean;
    coopDataAvailable: boolean;
    coopFilters: CoopFilterState;
    onCoopFiltersChange: (next: CoopFilterState) => void;
}

/** The shared entry point wrapped around the /games field set. */
export function GamesFilterPanel(props: GamesFilterPanelProps): JSX.Element {
    const clearAll = useClearAllGamesFilters(props.onCoopFiltersChange);
    return (
        <FilterEntry activeCount={props.activeCount} isOpen={props.isOpen} onOpenChange={props.onOpenChange} onClearAll={clearAll}>
            <GamesFilterBody {...props} />
        </FilterEntry>
    );
}

/** Three columns on desktop, one stack in the sheet. LFG on pauses everything below it. */
function GamesFilterBody({ isSearching, coopDataAvailable, coopFilters, onCoopFiltersChange }: GamesFilterPanelProps): JSX.Element {
    const { isLfgOnly, toggleLfgFilter } = useLfgFilterParam();
    const library = useLibraryFilterParams();
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            <div className="flex flex-col gap-5">
                <LfgField isLfgOnly={isLfgOnly} onToggle={toggleLfgFilter} />
                <PlayersField filters={library} disabled={isLfgOnly} />
                <OwnersField filters={library} disabled={isLfgOnly} />
                {!isLfgOnly && <LibraryFilterHint filters={library} />}
            </div>
            <GenresField
                selectedGenres={library.selectedGenres} onGenresChange={library.setSelectedGenres}
                disabled={isLfgOnly} isSearching={isSearching}
            />
            {/* Dormant until the first Co-Optimus sync lands (ROK-1402 full dormancy). */}
            {coopDataAvailable && (
                <FilterFieldGroup legend="Co-op" disabled={isLfgOnly} testId="coop-filter-group">
                    <CoopFilterControls state={coopFilters} onChange={onCoopFiltersChange} />
                    {countActiveCoopFilters(coopFilters) > 0 && (
                        <p data-testid="coop-filter-hint" className="mt-1 text-xs text-muted">Showing games with co-op data</p>
                    )}
                </FilterFieldGroup>
            )}
        </div>
    );
}
