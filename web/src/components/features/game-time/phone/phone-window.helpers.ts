/**
 * The profile drawer's visible hour window (ROK-1579 frame 3 → ROK-1584 §3).
 *
 * The profile now edits all 24 hours, laid out from 6 AM so the evening never
 * wraps. Only ten-ish rows fit a phone at the 44px touch row, so the day is
 * three bands:
 *
 *   ▴ earlier  6 AM – 6 PM   hidden by default, one tap above the day
 *     base     6 PM – 1 AM   the default view, fitted from the END so the
 *                            window always ends at 1 AM with no scroll
 *   ▾ later    1 AM – 6 AM   hidden by default, one tap below the day
 *
 * Each band auto-opens when the saved week claims an hour inside it (the shift
 * worker, the night owl) and remembers an EXPLICIT tap on its own.
 *
 * The poll's check keeps its seven evening hours: they fit, so neither band has
 * anything to reveal and neither toggle renders.
 */
import type { GameTimeSlot } from '@raid-ledger/contract';
import { isSlotActive } from '../game-time-slot.utils';

/** The touch row height the grid floors at (`minmax(44px, 1fr)`). */
export const ROW_PX = 44;

/** Never show fewer rows than this, however short the slot measures. */
export const MIN_FITTED_ROWS = 8;

/** Where the viewer's explicit band choices are remembered. */
export const PROFILE_WINDOW_KEY = 'rl.gameTime.profileWindow';

/** "Show earlier" covers 6 AM up to (not including) 6 PM. */
export const EARLIER_HOURS: number[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

/** "Show later" covers 1 AM up to (not including) 6 AM. */
export const LATER_HOURS: number[] = [1, 2, 3, 4, 5];

export interface HourSegments {
    /** The hours the "Show earlier" band owns, in the caller's order. */
    earlier: number[];
    /** The default view — everything that is in neither band. */
    base: number[];
    /** The hours the "Show later" band owns, in the caller's order. */
    later: number[];
}

/** Which band each hour of `allHours` belongs to, order preserved. */
export function splitHourRange(allHours: number[]): HourSegments {
    return {
        earlier: allHours.filter((h) => EARLIER_HOURS.includes(h)),
        base: allHours.filter((h) => !EARLIER_HOURS.includes(h) && !LATER_HOURS.includes(h)),
        later: allHours.filter((h) => LATER_HOURS.includes(h)),
    };
}

/** Which bands the viewer (or auto-expand) currently has open. */
export interface WindowChoice {
    earlier: boolean;
    later: boolean;
}

/**
 * The desktop profile grid's hour range for the open bands (ROK-1585 AC4a).
 *
 * The desktop grid has room for every row, so there is no fit: the default is
 * the evening (6 PM – 1 AM), "Show earlier" starts it at 6 AM and "Show later"
 * runs it to 6 AM. Ranges wrap midnight the way `useVisibleHours` reads them —
 * `[6, 6]` is all 24 hours from 6 AM.
 *
 * @param choice Which bands are open.
 * @returns `[start, end)` for `GameTimeGrid`'s `hourRange`.
 */
export function desktopHourRange(choice: WindowChoice): [number, number] {
    const start = choice.earlier ? EARLIER_HOURS[0] : EARLIER_HOURS[EARLIER_HOURS.length - 1] + 1;
    const end = choice.later ? LATER_HOURS[LATER_HOURS.length - 1] + 1 : LATER_HOURS[0];
    return [start, end];
}

export interface ProfileWindowHours {
    /** The hours to render, in order. */
    hours: number[];
    /** How many earlier hours the FIT drops — drives the toggle, even open. */
    hiddenEarlier: number;
    /** How many later hours the band holds back — 0 means no toggle. */
    hiddenLater: number;
}

/**
 * The hours a day slot of `heightPx` can show, given the open bands.
 *
 * @param allHours The caller's full range, in render order.
 * @param heightPx Measured height of the day slot; 0 before the first layout.
 * @param choice Which bands are open.
 * @returns The hours to render and what each band is holding back.
 */
export function profileWindowHours(
    allHours: number[], heightPx: number, choice: WindowChoice,
): ProfileWindowHours {
    const { earlier, base, later } = splitHourRange(allHours);
    const shownLater = choice.later ? later : [];
    // The later band eats rows from the same slot, so the fit shrinks by what it shows.
    const rows = Math.max(MIN_FITTED_ROWS, Math.floor(heightPx / ROW_PX) - shownLater.length);
    const head = [...earlier, ...base];
    const hiddenEarlier = Math.max(0, head.length - rows);
    const shownHead = choice.earlier || hiddenEarlier === 0 ? head : head.slice(-rows);
    return { hours: [...shownHead, ...shownLater], hiddenEarlier, hiddenLater: later.length };
}

/**
 * Whether any claimed hour of the saved week falls outside `window` — the shift
 * worker whose 10 AM–2 PM week would otherwise open off-screen.
 *
 * @param slots The saved (or draft) week, any day.
 * @param window The hours currently visible.
 * @param showable The hours the band COULD reveal; anything else must not latch
 *   auto-expand on forever.
 */
export function hasHourOutsideWindow(
    slots: readonly GameTimeSlot[], window: number[], showable: number[],
): boolean {
    const visible = new Set(window);
    const reachable = new Set(showable);
    return slots.some((s) => isSlotActive(s) && reachable.has(s.hour) && !visible.has(s.hour));
}

/** Whether the saved week claims any hour of `band` — the night owl's 3 AM. */
export function hasClaimedHourIn(slots: readonly GameTimeSlot[], band: number[]): boolean {
    const hours = new Set(band);
    return slots.some((s) => isSlotActive(s) && hours.has(s.hour));
}

/** A remembered band choice; `null` = never chosen, so auto-expand decides. */
export interface StoredWindow {
    earlier: boolean | null;
    later: boolean | null;
}

const NO_CHOICE: StoredWindow = { earlier: null, later: null };

/** `true`/`false` as stored, `null` for anything else (junk, missing). */
function readFlag(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

/**
 * The remembered bands. ROK-1579 stored a single `'full' | 'fit'` string for
 * the earlier band; that form migrates in place, leaving the later band
 * unchosen. Storage can throw in private mode — a missing preference is never
 * worth an exception.
 */
export function readProfileWindow(): StoredWindow {
    try {
        const raw = localStorage.getItem(PROFILE_WINDOW_KEY);
        if (raw === 'full') return { earlier: true, later: null };
        if (raw === 'fit') return { earlier: false, later: null };
        if (!raw || !raw.startsWith('{')) return NO_CHOICE;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return { earlier: readFlag(parsed.earlier), later: readFlag(parsed.later) };
    } catch {
        return NO_CHOICE;
    }
}

/**
 * Remember an EXPLICIT tap on one band; it outranks auto-expand from then on.
 * The other band keeps whatever it had, so one tap never freezes the other.
 */
export function writeProfileWindow(next: Partial<StoredWindow>): void {
    try {
        localStorage.setItem(PROFILE_WINDOW_KEY, JSON.stringify({ ...readProfileWindow(), ...next }));
    } catch {
        // A viewer with storage disabled simply gets the default each time.
    }
}
