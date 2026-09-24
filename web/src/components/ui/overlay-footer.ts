/**
 * The pinned action bar below a `Modal` / `BottomSheet` scroll body (ROK-1655).
 * One class string for both overlays: a Modal / BottomSheet pair (RescheduleModal)
 * passes the same actions to both, so the bars must lay them out alike —
 * right-aligned, spaced, wrapping.
 */
export const OVERLAY_FOOTER_CLASS = 'shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-edge px-4 py-3';
