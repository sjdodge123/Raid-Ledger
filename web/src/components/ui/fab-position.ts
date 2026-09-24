/**
 * ROK-1659 — where a floating action button sits above the bottom edge.
 *
 * Stacking rule (docs/design-system.md, the FAB rows):
 * - The bottom tab bar is `md:hidden` (`layout/bottom-tab-bar.tsx`) and slides
 *   away while the page scrolls down. A FAB sits at `bottom: 72` while it shows
 *   and `bottom: 16` while it hides.
 * - From 768px up there is no tab bar, but the feedback button
 *   (`feedback/FeedbackWidget.tsx`, `hidden md:flex fixed bottom-6 right-6`,
 *   48px, z-40) sits in the corner. A FAB that still renders there (the
 *   Filters FAB is `lg:hidden`, visible to 1023px) stacks above it at
 *   `bottom: 84` (24 + 48 + the 12px gap) and moves to `md:right-5` so the two
 *   circles share a centre line (20 + 28 = 24 + 24 = 48px from the edge).
 * - A page's create FAB stays the emerald primary at the bottom. A Filters FAB
 *   on the same page sits directly above it — same `right-4` edge, 12px gap:
 *   72 → 140, or 16 → 84 while the tab bar hides. The create FAB is
 *   `md:hidden`, so from 768px up only the feedback button is under it.
 *   Page padding at 768–1023px therefore clears 84 + 56 = 140px (`md:pb-40`).
 * - The page's bottom padding must clear the whole stack, not just the tab bar.
 */
import { useMediaQuery } from '../../hooks/use-media-query';
import { useScrollDirection } from '../../hooks/use-scroll-direction';

/**
 * The Filters FAB's face: size, shape, neutral tone, focus ring. `FilterFab`
 * adds its fixed position; the /dev gallery's static replica reuses it as-is.
 */
export const FILTER_FAB_FACE_CLASS = 'w-14 h-14 flex items-center justify-center rounded-full bg-surface border '
    + 'border-edge-strong shadow-lg text-foreground hover:bg-panel active:scale-95 transition-all duration-200 '
    + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/50';

/** A FAB is `w-14 h-14`. */
export const FAB_SIZE_PX = 56;
/** Vertical gap between two stacked FABs. */
export const FAB_STACK_GAP_PX = 12;
/** Clears the 56px bottom tab bar. */
export const FAB_BOTTOM_ABOVE_TAB_BAR = 72;
/** Below 768px while the tab bar has slid away on scroll-down. */
export const FAB_BOTTOM_NO_TAB_BAR = 16;
/** The feedback button's `bottom-6` (shown from 768px, `hidden md:flex`). */
export const FEEDBACK_BUTTON_BOTTOM_PX = 24;
/** The feedback button's `h-12`. */
export const FEEDBACK_BUTTON_SIZE_PX = 48;
/** 768px and up: one gap above the feedback button — 24 + 48 + 12 = 84. */
export const FAB_BOTTOM_ABOVE_FEEDBACK = FEEDBACK_BUTTON_BOTTOM_PX + FEEDBACK_BUTTON_SIZE_PX + FAB_STACK_GAP_PX;
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
 * From 768px there is no tab bar or create FAB; it clears the feedback button.
 */
export function useFilterFabBottom(stackAboveCreate: boolean): number {
    const createBottom = useCreateFabBottom();
    const noTabBar = useMediaQuery(NO_TAB_BAR_MQ);
    if (noTabBar) return FAB_BOTTOM_ABOVE_FEEDBACK;
    return stackAboveCreate ? createBottom + FAB_SIZE_PX + FAB_STACK_GAP_PX : createBottom;
}
