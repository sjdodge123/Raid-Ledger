import type { JSX } from 'react';
import { FunnelIcon } from '@heroicons/react/24/outline';
import type { GameInfo } from '../../stores/game-filter-store';

interface CalendarFilterChipProps {
    allKnownGames: GameInfo[];
    selectedGames: Set<string>;
    onOpen: () => void;
}

function formatChipLabel(allCount: number, selectedCount: number): string {
    if (selectedCount === allCount) return 'Filter: All games';
    if (selectedCount === 0) return 'Filter: No games';
    return `Filter: ${selectedCount} games`;
}

/**
 * Desktop chip that collapses the previous sidebar filter chrome (Select all,
 * Deselect all, inline list, "Show all N games..." overflow button) into a
 * single control that opens the existing CalendarGameFilterModal.
 *
 * ROK-1305 — element-count delta: 6 filter controls visible → 1 chip.
 */
export function CalendarFilterChip({
    allKnownGames, selectedGames, onOpen,
}: CalendarFilterChipProps): JSX.Element | null {
    if (allKnownGames.length === 0) return null;

    const label = formatChipLabel(allKnownGames.length, selectedGames.size);

    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label="Filter by Game"
            className="calendar-filter-chip"
        >
            <FunnelIcon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium">{label}</span>
        </button>
    );
}
