/**
 * Shared FilterPanel component (ROK-821, ROK-1659).
 * Desktop (1024px and up): inline collapsible panel. Below: BottomSheet wrapper.
 *
 * Pages normally render this through `FilterEntry` (filter-entry.tsx), which
 * pairs it with the right opener for the viewport.
 */
import { useEffect, useId, useRef, type JSX, type ReactNode, type RefObject } from 'react';
import { FunnelIcon } from '@heroicons/react/24/outline';
import { BottomSheet } from './bottom-sheet';
import { FilterCountBadge, type DescribeFilterCount } from './filter-count-badge';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';

export interface FilterPanelTriggerProps {
    /** Active filters (values differing from the page defaults) — NOT a result count. Badge hidden at 0. */
    activeCount: number;
    /** Whether the panel is open — drives `aria-expanded`. */
    isOpen?: boolean;
    onClick: () => void;
    /** Screen-reader wording for the count; defaults to "N active filters". */
    describeCount?: DescribeFilterCount;
}

const TRIGGER_CLASS = 'relative inline-flex shrink-0 items-center justify-center w-11 h-11 rounded-lg '
    + 'border border-edge hover:text-foreground hover:border-edge-strong transition-colors '
    + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/50';

/** Closed: `panel` fill, muted funnel. Open: `overlay` fill, foreground funnel. */
const triggerStateClass = (isOpen?: boolean): string => (isOpen ? 'bg-overlay text-foreground' : 'bg-panel text-muted');

/** 44px bordered funnel button with the active-filter count badge. */
export function FilterPanelTrigger({ activeCount, isOpen, onClick, describeCount }: FilterPanelTriggerProps): JSX.Element {
    const countId = useId();
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Filters"
            aria-expanded={isOpen}
            aria-describedby={activeCount > 0 ? countId : undefined}
            data-testid="filter-panel-trigger"
            className={`${TRIGGER_CLASS} ${triggerStateClass(isOpen)}`}
        >
            <FunnelIcon className="w-5 h-5" aria-hidden="true" />
            <FilterCountBadge count={activeCount} id={countId} describe={describeCount} offset="trigger" />
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

/** The open funnel (only one filter entry per page); focus goes back to it on Escape. */
const OPEN_TRIGGER_SELECTOR = '[data-testid="filter-panel-trigger"][aria-expanded="true"]';

/**
 * Closes the desktop inline panel on Escape (the BottomSheet handles its own)
 * and, when focus was inside the panel, hands it back to the funnel — the
 * collapsed panel is `inert`, so focus left in it would be lost.
 */
function useEscapeToClose(active: boolean, onClose: () => void, panelRef: RefObject<HTMLDivElement | null>): void {
    useEffect(() => {
        if (!active) return undefined;
        const handleKeyDown = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape') return;
            const focusInside = panelRef.current?.contains(document.activeElement) ?? false;
            const trigger = document.querySelector<HTMLElement>(OPEN_TRIGGER_SELECTOR);
            onClose();
            if (focusInside) trigger?.focus();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [active, onClose, panelRef]);
}

/** Responsive filter panel: inline on desktop, BottomSheet below 1024px. */
export function FilterPanel({ activeFilterCount, onClearAll, isOpen, onToggle, onClose, children }: FilterPanelProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const close = onClose ?? onToggle;
    const panelRef = useRef<HTMLDivElement>(null);
    useEscapeToClose(isDesktop && isOpen, close, panelRef);

    if (!isDesktop) {
        return (
            <BottomSheet isOpen={isOpen} onClose={close} title="Filters">
                <MobileClearRow activeFilterCount={activeFilterCount} onClearAll={onClearAll} />
                {children}
            </BottomSheet>
        );
    }

    return (
        <InlinePanel panelRef={panelRef} isOpen={isOpen} activeFilterCount={activeFilterCount} onClearAll={onClearAll}>
            {children}
        </InlinePanel>
    );
}

/** The desktop inline card; a long body scrolls inside it. */
function InlinePanel({ panelRef, isOpen, activeFilterCount, onClearAll, children }: {
    panelRef: RefObject<HTMLDivElement | null>; isOpen: boolean;
    activeFilterCount: number; onClearAll: () => void; children: ReactNode;
}): JSX.Element {
    return (
        // Collapsed = `inert` + `aria-hidden`: out of the Tab order and the a11y tree, but
        // still mounted so body effects (e.g. the ROK-1255 auto-seed) keep running.
        <div
            ref={panelRef}
            data-testid="filter-panel"
            inert={!isOpen}
            aria-hidden={!isOpen || undefined}
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
