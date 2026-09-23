/**
 * ROK-1659 / ROK-1662 — THE filter entry point every filtering surface uses
 * (/games, Common Ground, Calendar). One filter set, two openers:
 *
 * - 1024px and up (`DESKTOP_MQ`): `FilterEntryTrigger` — the funnel the page
 *   puts at the right end of its toolbar — opens the inline `FilterPanel`
 *   that `FilterEntry` renders where it is placed (under the toolbar).
 * - Below 1024px (phones AND tablets): `FilterEntry` renders the Filters FAB
 *   (`FilterFab`, bottom-right) which opens the same controls in the
 *   `BottomSheet`. `FilterEntryTrigger` renders nothing there.
 *
 * The badge is the ACTIVE-FILTER count the page supplies (hidden at 0). Chips
 * are for toggles and navigation, never a page's filter set.
 *
 * @example
 * const [filtersOpen, setFiltersOpen] = useState(false);
 * <div className="flex items-center gap-2">
 *     <SearchInput value={q} onChange={setQ} label="Search games" />
 *     <FilterEntryTrigger activeCount={active} isOpen={filtersOpen} onOpenChange={setFiltersOpen} />
 * </div>
 * <FilterEntry activeCount={active} isOpen={filtersOpen} onOpenChange={setFiltersOpen} onClearAll={reset}>
 *     <MyFilterControls />
 * </FilterEntry>
 */
import { useCallback, type JSX, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import type { DescribeFilterCount } from './filter-count-badge';
import { FilterFab } from './filter-fab';
import { FilterPanel, FilterPanelTrigger } from './filter-panel';

interface FilterEntryOpenState {
    /** Active filters (values differing from the page defaults). Badge hidden at 0. */
    activeCount: number;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    /** Screen-reader wording for the badge count; defaults to "N active filters". */
    describeCount?: DescribeFilterCount;
}

export interface FilterEntryProps extends FilterEntryOpenState {
    /** "Clear all" — shown while `activeCount > 0`. */
    onClearAll: () => void;
    /** The filter controls (form primitives). Long bodies scroll inside the panel / sheet. */
    children: ReactNode;
    /** Below 768px, lift the FAB above the page's create FAB (see `fab-position.ts`). */
    stackAboveCreate?: boolean;
}

export type FilterEntryTriggerProps = FilterEntryOpenState;

/** Inline panel at 1024px and up; Filters FAB + BottomSheet below. */
export function FilterEntry({
    activeCount, isOpen, onOpenChange, onClearAll, children, stackAboveCreate = false, describeCount,
}: FilterEntryProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const toggle = useCallback(() => onOpenChange(!isOpen), [onOpenChange, isOpen]);
    const close = useCallback(() => onOpenChange(false), [onOpenChange]);
    return (
        <>
            {!isDesktop && (
                <FilterFab activeCount={activeCount} isOpen={isOpen} onClick={toggle} stackAboveCreate={stackAboveCreate}
                    describeCount={describeCount} />
            )}
            <FilterPanel activeFilterCount={activeCount} onClearAll={onClearAll} isOpen={isOpen} onToggle={toggle} onClose={close}>
                {children}
            </FilterPanel>
        </>
    );
}

/** The toolbar funnel — desktop only (1024px and up); renders nothing below, where the FAB opens filters. */
export function FilterEntryTrigger({
    activeCount, isOpen, onOpenChange, describeCount,
}: FilterEntryTriggerProps): JSX.Element | null {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (!isDesktop) return null;
    return (
        <FilterPanelTrigger activeCount={activeCount} isOpen={isOpen} onClick={() => onOpenChange(!isOpen)}
            describeCount={describeCount} />
    );
}
