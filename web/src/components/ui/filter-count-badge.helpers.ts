/**
 * ROK-1659 — non-component exports for `filter-count-badge.tsx`, kept apart so
 * that file exports only components (react-refresh/only-export-components).
 */

/** Screen-reader wording for the count, e.g. the calendar's `n => `${n} games hidden``. */
export type DescribeFilterCount = (count: number) => string;

/** Default wording: "1 active filter" / "N active filters". */
export const describeActiveFilters: DescribeFilterCount = (count) =>
    `${count} active ${count === 1 ? 'filter' : 'filters'}`;
