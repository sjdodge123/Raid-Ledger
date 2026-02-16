/**
 * Z-index hierarchy for Raid-Ledger UI.
 * Based on EP-10 mobile design spec (ROK-330).
 *
 * Stack order (bottom → top):
 *   DEFAULT → DROPDOWN → TOOLBAR/FAB → HEADER/TAB_BAR → BOTTOM_SHEET → MODAL → TOAST
 */
export const Z_INDEX = {
    /** Base content layer */
    DEFAULT: 0,

    /** Dropdowns, popovers, autocomplete lists */
    DROPDOWN: 10,

    /** Sticky per-page toolbars, calendar toolbar, filter bars */
    TOOLBAR: 30,

    /** Floating action buttons (Create Event, Jump to Today) */
    FAB: 30,

    /** Site header (sticky) */
    HEADER: 40,

    /** Bottom tab bar (mobile, Strategy 2/3) */
    TAB_BAR: 40,

    /** Bottom sheets (game filter, settings) */
    BOTTOM_SHEET: 45,

    /** Modals, drawers, overlays, MoreDrawer */
    MODAL: 50,

    /** Toast notifications (highest layer) */
    TOAST: 60,
} as const;
