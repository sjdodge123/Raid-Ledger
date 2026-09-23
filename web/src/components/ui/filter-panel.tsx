/**
 * Shared FilterPanel component (ROK-821, ROK-1659).
 * Desktop (1024px and up): inline collapsible panel. Below: BottomSheet wrapper.
 *
 * Pages normally render this through `FilterEntry` (filter-entry.tsx), which
 * pairs it with the right opener for the viewport.
 */
import { useEffect, useId, type JSX, type ReactNode } from 'react';
import { FunnelIcon } from '@heroicons/react/24/outline';
import { BottomSheet } from './bottom-sheet';
import { FilterCountBadge } from './filter-count-badge';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';

export interface FilterPanelTriggerProps {
    /** Active filters (values differing from the page defaults) — NOT a result count. Badge hidden at 0. */
    activeCount: number;
    /** Whether the panel is open — drives `aria-expanded`. */
    isOpen?: boolean;
    onClick: () => void;
}

const TRIGGER_CLASS = 'relative inline-flex shrink-0 items-center justify-center w-11 h-11 rounded-lg '
    + 'border border-edge text-muted hover:text-foreground hover:border-edge-strong transition-colors '
    + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/50';

/** 44px bordered funnel button with the active-filter count badge. */
export function FilterPanelTrigger({ activeCount, isOpen, onClick }: FilterPanelTriggerProps): JSX.Element {
    const countId = useId();
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Filters"
            aria-expanded={isOpen}
            aria-describedby={activeCount > 0 ? countId : undefined}
            data-testid="filter-panel-trigger"
            className={TRIGGER_CLASS}
        >
            <FunnelIcon className="w-5 h-5" aria-hidden="true" />
            <FilterCountBadge count={activeCount} id={countId} />
        </button>
    );
}

export interface FilterPanelProps {
    activeFilterCount: number;
    onClearAll: () => void;
    isOpen: boolean;
    onToggle: () => void;
    /** Close handler for the sheet's X / scrim / Escape and the desktop Escape. Defaults to `onToggle`. */
    onClose?: () => void;
    children: ReactNode;
}

/** Closes the desktop inline panel on Escape (the BottomSheet handles its own). */
function useEscapeToClose(active: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!active) return undefined;
        const handleKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [active, onClose]);
}

/** Responsive filter panel: inline on desktop, BottomSheet below 1024px. */
export function FilterPanel({ activeFilterCount, onClearAll, isOpen, onToggle, onClose, children }: FilterPanelProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const close = onClose ?? onToggle;
    useEscapeToClose(isDesktop && isOpen, close);

    if (!isDesktop) {
        return (
            <BottomSheet isOpen={isOpen} onClose={close} title="Filters">
                <MobileClearRow activeFilterCount={activeFilterCount} onClearAll={onClearAll} />
                {children}
            </BottomSheet>
        );
    }

    return (
        <div
            data-testid="filter-panel"
            className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
        >
            {/* Bounded card: the header stays put and a long body scrolls instead of being clipped. */}
            <div className="flex flex-col max-h-[500px] bg-panel border border-edge rounded-lg p-4">
                <FilterPanelHeader activeFilterCount={activeFilterCount} onClearAll={onClearAll} />
                <div data-testid="filter-panel-body" className="min-h-0 overflow-y-auto">
                    {children}
                </div>
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
        <div className="flex shrink-0 items-center justify-between mb-4">
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
