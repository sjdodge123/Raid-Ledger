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

/** Screen-reader wording for the count, e.g. the calendar's `n => `${n} games hidden``. */
export type DescribeFilterCount = (count: number) => string;

export const describeActiveFilters: DescribeFilterCount = (count) =>
    `${count} active ${count === 1 ? 'filter' : 'filters'}`;

interface FilterCountBadgeProps {
    count: number;
    /** Id for the `sr-only` description; the opener points `aria-describedby` at it. */
    id: string;
    /** Screen-reader wording; defaults to "N active filters". */
    describe?: DescribeFilterCount;
    /** `fab`: 4px corner offset (the 56px FAB). `trigger`: 6px (the 44px toolbar funnel). */
    offset?: 'fab' | 'trigger';
}

const OFFSET_CLS = { fab: '-top-1 -right-1', trigger: '-top-1.5 -right-1.5' } as const;

/** Solid `bg-success` pill at the opener's top-right corner. Renders nothing at 0. */
export function FilterCountBadge({
    count, id, describe = describeActiveFilters, offset = 'fab',
}: FilterCountBadgeProps): JSX.Element | null {
    if (count <= 0) return null;
    return (
        <>
            <span
                aria-hidden="true"
                data-testid="filter-count-badge"
                className={`absolute ${OFFSET_CLS[offset]} flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold text-white bg-success rounded-full`}
            >
                {count}
            </span>
            <span id={id} className="sr-only">
                {describe(count)}
            </span>
        </>
    );
}
