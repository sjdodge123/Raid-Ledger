/**
 * Players-specific filter controls rendered as FilterPanel children (ROK-821).
 * Source checkboxes, play history dropdown, playtime input, role dropdown.
 */
import type { JSX } from 'react';
import type { PlayerFilters as FiltersState } from '../../hooks/use-player-filters';
import { GameFilterInput } from './filters/game-filter-input';
import { SourceMultiSelect } from './filters/source-multi-select';
import { PlayHistorySelect } from './filters/play-history-select';
import { PlaytimeMinInput } from './filters/playtime-min-input';
import { RoleSelect } from './filters/role-select';

interface PlayerFiltersProps {
    filters: FiltersState;
    setFilter: <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => void;
}

/** Players-specific filter controls grid. */
export function PlayerFilters({ filters, setFilter }: PlayerFiltersProps): JSX.Element {
    const hasGame = !!filters.gameId;
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <GameFilterInput
                gameId={filters.gameId}
                onChange={(id) => setFilter('gameId', id)}
            />
            <SourceMultiSelect
                selectedSources={filters.sources ?? []}
                onChange={(sources) => setFilter('sources', sources.length > 0 ? sources : undefined)}
            />
            <RoleSelect
                value={filters.role ?? ''}
                onChange={(v) => setFilter('role', v || undefined)}
            />
            <PlayHistorySelect
                value={filters.playHistory ?? ''}
                onChange={(v) => setFilter('playHistory', v || undefined)}
                disabled={!hasGame}
            />
            <PlaytimeMinInput
                value={filters.playtimeMin}
                onChange={(v) => setFilter('playtimeMin', v || undefined)}
                disabled={!hasGame}
            />
        </div>
    );
}
