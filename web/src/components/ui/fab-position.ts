/**
 * ROK-1659 — where a floating action button sits above the bottom edge.
 *
 * Stacking rule (docs/design-system.md, the FAB rows):
 * - The bottom tab bar is `md:hidden` (`layout/bottom-tab-bar.tsx`) and slides
 *   away while the page scrolls down. A FAB sits at `bottom: 72` while it shows
 *   and `bottom: 16` while it hides.
 * - From 768px up there is no tab bar at all, so a FAB that still renders there
 *   (the Filters FAB is `lg:hidden`, visible to 1023px) sits at `bottom: 16`.
 * - A page's create FAB stays the emerald primary at the bottom. A Filters FAB
 *   on the same page sits directly above it — same `right-4` edge, 12px gap:
 *   72 → 140, or 16 → 84 while the tab bar hides. The create FAB is
 *   `md:hidden`, so from 768px up there is nothing to stack on.
 * - The page's bottom padding must clear the whole stack, not just the tab bar.
 */
import { useMediaQuery } from '../../hooks/use-media-query';
import { useScrollDirection } from '../../hooks/use-scroll-direction';

/** A FAB is `w-14 h-14`. */
export const FAB_SIZE_PX = 56;
/** Vertical gap between two stacked FABs. */
export const FAB_STACK_GAP_PX = 12;
/** Clears the 56px bottom tab bar. */
export const FAB_BOTTOM_ABOVE_TAB_BAR = 72;
/** No tab bar under the FAB (hidden on scroll, or 768px and up). */
export const FAB_BOTTOM_NO_TAB_BAR = 16;
/** Mirrors the tab bar's `md:hidden`: at 768px and up there is no tab bar. */
export const NO_TAB_BAR_MQ = '(min-width: 768px)';

/** Bottom offset of a page's create FAB (`FAB`) — tracks the tab bar only. */
export function useCreateFabBottom(): number {
    const tabBarHidden = useScrollDirection() === 'down';
    return tabBarHidden ? FAB_BOTTOM_NO_TAB_BAR : FAB_BOTTOM_ABOVE_TAB_BAR;
}

/**
 * Bottom offset of the Filters FAB. `stackAboveCreate` lifts it one FAB plus
 * the gap above the page's create FAB while that FAB is on screen (< 768px).
 */
export function useFilterFabBottom(stackAboveCreate: boolean): number {
    const createBottom = useCreateFabBottom();
    const noTabBar = useMediaQuery(NO_TAB_BAR_MQ);
    if (noTabBar) return FAB_BOTTOM_NO_TAB_BAR;
    return stackAboveCreate ? createBottom + FAB_SIZE_PX + FAB_STACK_GAP_PX : createBottom;
}
