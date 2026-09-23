/**
 * ROK-1659 — the Filters FAB: the filter opener on phones AND tablets
 * (below 1024px). Desktop uses the toolbar funnel (`FilterPanelTrigger`).
 *
 * Neutral tone so it never competes with a page's emerald create FAB; the
 * active-filter count rides on an emerald badge. Position and the stacking
 * rule live in `fab-position.ts`. Surfaces normally get this through
 * `FilterEntry` rather than rendering it directly.
 *
 * Portaled to `document.body`: `FilterEntry` is often placed inside a sticky
 * toolbar (Common Ground's `sticky top-14 z-20` hero), whose stacking context
 * would otherwise trap the FAB's z-index below the page content around it.
 */
import { useId, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { FunnelIcon } from '@heroicons/react/24/outline';
import { Z_INDEX } from '../../lib/z-index';
import { FilterCountBadge } from './filter-count-badge';
import type { DescribeFilterCount } from './filter-count-badge.helpers';
import { useFilterFabBottom } from './fab-position';

export interface FilterFabProps {
    /** Active filters (values differing from the page defaults). Badge hidden at 0. */
    activeCount: number;
    /** Whether the filter sheet is open — drives `aria-expanded`. */
    isOpen: boolean;
    onClick: () => void;
    /** Sit above the page's create FAB (72 → 140 / 16 → 84) instead of in its place. */
    stackAboveCreate?: boolean;
    /** Screen-reader wording for the count; defaults to "N active filters". */
    describeCount?: DescribeFilterCount;
}

const FAB_CLASS = 'fixed right-4 md:right-5 w-14 h-14 lg:hidden flex items-center justify-center rounded-full '
    + 'bg-surface border border-edge-strong shadow-lg text-foreground hover:bg-panel active:scale-95 '
    + 'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/50';

/** 56px round neutral button, bottom-right, `lg:hidden`, with the active-filter badge. */
export function FilterFab({ activeCount, isOpen, onClick, stackAboveCreate = false, describeCount }: FilterFabProps): JSX.Element {
    const countId = useId();
    const bottom = useFilterFabBottom(stackAboveCreate);
    return createPortal(
        <button
            type="button"
            onClick={onClick}
            aria-label="Filters"
            aria-expanded={isOpen}
            aria-describedby={activeCount > 0 ? countId : undefined}
            data-testid="filter-fab"
            className={FAB_CLASS}
            style={{ zIndex: Z_INDEX.FAB, bottom }}
        >
            <FunnelIcon className="w-6 h-6" aria-hidden="true" />
            <FilterCountBadge count={activeCount} id={countId} describe={describeCount} />
        </button>,
        document.body,
    );
}
