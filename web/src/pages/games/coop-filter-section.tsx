/**
 * ROK-1402 — co-op filter trigger + panel + NULL-semantics hint for the games
 * library page. Rendered on the discover tab regardless of the search query so
 * the predicates compose with search as well as with the genre pills.
 */
import { useEffect, type JSX } from 'react';
import { FilterPanel, FilterPanelTrigger } from '../../components/ui/filter-panel';
import { CoopFilterControls } from './coop-filter-controls';
import {
    EMPTY_COOP_FILTERS,
    countActiveCoopFilters,
    type CoopFilterState,
} from './coop-filter.helpers';

interface CoopFilterSectionProps {
    filters: CoopFilterState;
    onFiltersChange: (next: CoopFilterState) => void;
    isOpen: boolean;
    onToggleOpen: () => void;
    onClose: () => void;
    resultCount: number;
    /** Any loaded game carries Co-Optimus data — gates the mode toggles. */
    coopDataAvailable: boolean;
}

/** Closes the desktop inline panel on Escape (the BottomSheet handles its own). */
function useEscapeToClose(isOpen: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!isOpen) return undefined;
        const handleKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);
}

/** Funnel trigger, hint line, and the responsive co-op FilterPanel. */
export function CoopFilterSection({
    filters,
    onFiltersChange,
    isOpen,
    onToggleOpen,
    onClose,
    resultCount,
    coopDataAvailable,
}: CoopFilterSectionProps): JSX.Element {
    const activeFilterCount = countActiveCoopFilters(filters);
    useEscapeToClose(isOpen, onClose);

    return (
        <div className="mb-4">
            <CoopFilterTriggerRow
                activeFilterCount={activeFilterCount}
                resultCount={resultCount}
                onToggleOpen={onToggleOpen}
            />
            <FilterPanel
                activeFilterCount={activeFilterCount}
                onClearAll={() => onFiltersChange(EMPTY_COOP_FILTERS)}
                isOpen={isOpen}
                onToggle={onClose}
            >
                <CoopFilterControls state={filters} onChange={onFiltersChange} showModeToggles={coopDataAvailable} />
            </FilterPanel>
        </div>
    );
}

/** Funnel trigger with its result badge, plus the NULL-semantics hint. */
function CoopFilterTriggerRow({ activeFilterCount, resultCount, onToggleOpen }: {
    activeFilterCount: number;
    resultCount: number;
    onToggleOpen: () => void;
}): JSX.Element {
    return (
        <div className="flex items-center gap-3">
            <FilterPanelTrigger
                resultCount={resultCount}
                hasActiveFilters={activeFilterCount > 0}
                onClick={onToggleOpen}
            />
            {activeFilterCount > 0 && <CoopFilterHint />}
        </div>
    );
}

/**
 * NULL-semantics disclosure: games without co-op data are dropped while any
 * co-op predicate is active, so say so instead of silently hiding them.
 */
function CoopFilterHint(): JSX.Element {
    return (
        <p data-testid="coop-filter-hint" className="text-xs text-muted">
            Showing games with co-op data
        </p>
    );
}
