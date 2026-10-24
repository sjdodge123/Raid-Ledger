/**
 * Class lists for the §4.3 toggle chip (ROK-1943). Split from `filter-chip.tsx`
 * so that file exports only the component (react-refresh), mirroring
 * `button-classes.ts`. Use `FilterChip`; these exist for the gallery's static
 * hover sample and for a caller that must style a non-button the same way.
 */
/** §4.3 chip geometry shared by both states. */
export const FILTER_CHIP_BASE =
    'inline-flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
/** §4.3 pressed (ON) state — amber tint, `text-amber-400` label. */
export const FILTER_CHIP_ON = 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20';
/** §4.3 unpressed (OFF) state — panel tokens. */
export const FILTER_CHIP_OFF = 'bg-panel border border-edge text-secondary hover:bg-overlay';

/** Full class list for a chip in the given pressed state. */
export function filterChipClass(pressed: boolean): string {
    return `${FILTER_CHIP_BASE} ${pressed ? FILTER_CHIP_ON : FILTER_CHIP_OFF}`;
}
