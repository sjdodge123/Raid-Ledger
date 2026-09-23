/**
 * ROK-1659 — the active-filter count badge shared by both filter openers: the
 * toolbar funnel (`FilterPanelTrigger`, 1024px and up) and the Filters FAB
 * (`FilterFab`, below 1024px).
 *
 * The count is ACTIVE FILTERS — values that differ from the page's defaults —
 * never a result count, and the badge is hidden at zero. Both openers are named
 * "Filters" by `aria-label`, which hides the badge text from assistive tech, so
 * the count is re-exposed through `aria-describedby` → the `sr-only` span here.
 */
import type { JSX } from 'react';

interface FilterCountBadgeProps {
    count: number;
    /** Id for the `sr-only` description; the opener points `aria-describedby` at it. */
    id: string;
}

/** Solid `bg-success` pill at the opener's top-right corner. Renders nothing at 0. */
export function FilterCountBadge({ count, id }: FilterCountBadgeProps): JSX.Element | null {
    if (count <= 0) return null;
    return (
        <>
            <span
                aria-hidden="true"
                data-testid="filter-count-badge"
                className="absolute -top-1 -right-1 flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold text-white bg-success rounded-full"
            >
                {count}
            </span>
            <span id={id} className="sr-only">
                {count} active {count === 1 ? 'filter' : 'filters'}
            </span>
        </>
    );
}
