/**
 * Shared FilterPanel component (ROK-821).
 * Desktop: inline collapsible panel. Mobile: BottomSheet wrapper.
 */
import type { JSX, ReactNode } from 'react';
import { FunnelIcon } from '@heroicons/react/24/outline';
import { BottomSheet } from './bottom-sheet';
import { useMediaQuery } from '../../hooks/use-media-query';

interface FilterPanelTriggerProps {
    activeFilterCount: number;
    onClick: () => void;
}

/** Funnel icon button with optional badge showing active filter count. */
export function FilterPanelTrigger({ activeFilterCount, onClick }: FilterPanelTriggerProps): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Filters"
            className="relative inline-flex items-center gap-1.5 px-3 py-2 text-sm text-muted hover:text-foreground transition-colors"
        >
            <FunnelIcon className="w-5 h-5" />
            {activeFilterCount > 0 && <FilterBadge count={activeFilterCount} />}
        </button>
    );
}

/** Emerald badge showing filter count. */
function FilterBadge({ count }: { count: number }): JSX.Element {
    return (
        <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-emerald-500 rounded-full">
            {count}
        </span>
    );
}

interface FilterPanelProps {
    activeFilterCount: number;
    onClearAll: () => void;
    isOpen: boolean;
    onToggle: () => void;
    children: ReactNode;
}

/** Responsive filter panel: inline on desktop, BottomSheet on mobile. */
export function FilterPanel({ activeFilterCount, onClearAll, isOpen, onToggle, children }: FilterPanelProps): JSX.Element {
    const isDesktop = useMediaQuery('(min-width: 768px)');

    if (!isDesktop) {
        return (
            <BottomSheet isOpen={isOpen} onClose={onToggle} title="Filters">
                <MobileClearRow activeFilterCount={activeFilterCount} onClearAll={onClearAll} />
                {children}
            </BottomSheet>
        );
    }

    return (
        <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
        >
            <div className="bg-panel border border-edge rounded-lg p-4">
                <FilterPanelHeader activeFilterCount={activeFilterCount} onClearAll={onClearAll} />
                {children}
            </div>
        </div>
    );
}

/** "Clear all" button row for mobile BottomSheet (title provided by BottomSheet itself). */
function MobileClearRow({ activeFilterCount, onClearAll }: {
    activeFilterCount: number;
    onClearAll: () => void;
}): JSX.Element | null {
    if (activeFilterCount === 0) return null;
    return (
        <div className="flex justify-end mb-4">
            <ClearAllButton onClearAll={onClearAll} />
        </div>
    );
}

/** Title row with "Filters" and optional "Clear all" button. */
function FilterPanelHeader({ activeFilterCount, onClearAll }: {
    activeFilterCount: number;
    onClearAll: () => void;
}): JSX.Element {
    return (
        <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Filters</h3>
            {activeFilterCount > 0 && <ClearAllButton onClearAll={onClearAll} />}
        </div>
    );
}

/** Shared "Clear all" button. */
function ClearAllButton({ onClearAll }: { onClearAll: () => void }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClearAll}
            aria-label="Clear all"
            className="text-sm text-muted hover:text-foreground transition-colors"
        >
            Clear all
        </button>
    );
}
