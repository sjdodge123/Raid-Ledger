/**
 * The profile drawer's visible hour window (ROK-1579, approved frame 3 of
 * `planning-artifacts/design-poll-drawer-one-view-2026-09-16.html`).
 *
 * The profile edits 17 hours (9 AM–1 AM) and only ten-ish of them fit a phone
 * at the 44px touch row. The drawer therefore opens on as many rows as FIT,
 * taken from the END of the range, so the window always ends at the same late
 * hour (≈ 3 PM–1 AM on an 812px phone) and the evening is on screen without a
 * scroll. "Show earlier" adds the rest and the grid scrolls (the day is its own
 * scroll container since ROK-1579 lane 4).
 *
 * The check variant keeps its seven evening hours: they fit, so `fittedWindow`
 * is a no-op for them.
 */
import type { GameTimeSlot } from '@raid-ledger/contract';
import { isSlotActive } from '../game-time-slot.utils';

/** The touch row height the grid floors at (`minmax(44px, 1fr)`). */
export const ROW_PX = 44;

/** Never show fewer rows than this, however short the slot measures. */
export const MIN_FITTED_ROWS = 8;

/** Where the viewer's explicit Show-earlier choice is remembered. */
export const PROFILE_WINDOW_KEY = 'rl.gameTime.profileWindow';

export interface FittedWindow {
    /** The hours to render: the fitted tail, or all of them when expanded. */
    hours: number[];
    /** How many earlier hours the FIT drops — drives the toggle, even expanded. */
    hiddenEarlier: number;
}

/**
 * The hours a day slot of `heightPx` can show at the 44px row.
 *
 * @param allHours The caller's full range, in render order.
 * @param heightPx Measured height of the day slot; 0 before the first layout.
 * @param expanded Whether the viewer asked for the earlier hours back.
 * @returns The hours to render and how many earlier ones the fit hides.
 */
export function fittedWindow(allHours: number[], heightPx: number, expanded: boolean): FittedWindow {
    const rows = Math.max(MIN_FITTED_ROWS, Math.floor(heightPx / ROW_PX));
    const hiddenEarlier = Math.max(0, allHours.length - rows);
    return {
        hours: expanded || hiddenEarlier === 0 ? allHours : allHours.slice(-rows),
        hiddenEarlier,
    };
}

/**
 * Whether any claimed hour of the saved week falls outside `window` — the shift
 * worker whose 10 AM–2 PM week would otherwise open off-screen.
 *
 * @param slots The saved (or draft) week, any day.
 * @param window The hours currently visible.
 */
export function hasHourOutsideWindow(
    slots: readonly GameTimeSlot[], window: number[], allHours: number[],
): boolean {
    const visible = new Set(window);
    const showable = new Set(allHours);
    // Only hours the FULL range would reveal count — a 7 AM slot (edited via the
    // refresh modal's wider range) must not latch auto-expand on forever.
    return slots.some((s) => isSlotActive(s) && showable.has(s.hour) && !visible.has(s.hour));
}

/**
 * The remembered window, or `null` when the viewer never chose one (auto-expand
 * then decides). Storage can throw in private mode — a missing preference is
 * never worth an exception.
 */
export function readProfileWindow(): boolean | null {
    try {
        const raw = localStorage.getItem(PROFILE_WINDOW_KEY);
        return raw === 'full' ? true : raw === 'fit' ? false : null;
    } catch {
        return null;
    }
}

/** Remember an EXPLICIT toggle; it outranks auto-expand from then on. */
export function writeProfileWindow(expanded: boolean): void {
    try {
        localStorage.setItem(PROFILE_WINDOW_KEY, expanded ? 'full' : 'fit');
    } catch {
        // A viewer with storage disabled simply gets the default each time.
    }
}
