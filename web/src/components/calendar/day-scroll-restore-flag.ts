/**
 * ROK-2303: router `state` carried by the event page's "Back to Calendar"
 * button. That button is a PUSH, so the Day-view scroll restore (normally
 * POP-only) also accepts a mount carrying this flag, and the app-wide
 * ScrollToTop leaves such a navigation alone.
 */
export const RESTORE_DAY_SCROLL_STATE = { restoreDayScroll: true } as const;

export function hasRestoreDayScrollFlag(state: unknown): boolean {
    return typeof state === 'object' && state !== null && 'restoreDayScroll' in state && state.restoreDayScroll === true;
}
