import { useEffect, useRef, type MutableRefObject } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';
import { safeSessionGetItem, safeSessionRemoveItem, safeSessionSetItem } from '../../lib/safe-storage';
import { isPhoneCalendarWidth } from './phone-calendar-width';
import { hasRestoreDayScrollFlag } from './day-scroll-restore-flag';

/**
 * ROK-2303: on a phone the Day view scrolls the window (`.rbc-time-content` is
 * `overflow: visible`), and the page remounts when Back returns from an event,
 * so the browser's own restore runs before the grid is tall enough. Opening an
 * event from the phone Day view saves the window offset here; the next mount
 * reached by Back (a POP) or by the event page's "Back to Calendar" button (a
 * PUSH carrying `RESTORE_DAY_SCROLL_STATE`) on the same date in Day view puts
 * it back. Any other mount just drops the saved offset.
 */
const STORAGE_KEY = 'rl:calendar-day-scroll';
const MAX_RESTORE_FRAMES = 30;
/** A user gesture that ends the restore: the user is scrolling on their own. */
const USER_SCROLL_EVENTS = ['touchstart', 'wheel'] as const;

interface SavedDayScroll {
    date: string;
    y: number;
}

/** Called when an event is opened from the Day view; a no-op at tablet/desktop width. */
export function rememberDayViewScroll(date: string): void {
    if (!isPhoneCalendarWidth()) return;
    safeSessionSetItem(STORAGE_KEY, JSON.stringify({ date, y: window.scrollY }));
}

function parseSaved(raw: string): SavedDayScroll | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || !('date' in parsed) || !('y' in parsed)) return null;
        const { date, y } = parsed;
        return typeof date === 'string' && typeof y === 'number' ? { date, y } : null;
    } catch {
        return null;
    }
}

function takeSavedDayScroll(): SavedDayScroll | null {
    const raw = safeSessionGetItem(STORAGE_KEY);
    safeSessionRemoveItem(STORAGE_KEY);
    return raw === null ? null : parseSaved(raw);
}

/**
 * Scrolls the window to `y` on the next frames until it sticks (the grid may
 * still be growing) or the frame budget runs out. The first touch or wheel
 * ends it, so it never fights a user who starts scrolling. `onApplied` runs
 * once, when the first frame has scrolled. Returns a cancel.
 */
export function restoreWindowScroll(
    y: number,
    maxFrames: number = MAX_RESTORE_FRAMES,
    onApplied?: () => void,
): () => void {
    let frame = 0;
    let handle = 0;
    const stop = (): void => {
        window.cancelAnimationFrame(handle);
        for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, stop);
    };
    const step = (): void => {
        window.scrollTo(window.scrollX, y);
        frame += 1;
        if (frame === 1) onApplied?.();
        if (Math.abs(window.scrollY - y) <= 1 || frame >= maxFrames) { stop(); return; }
        handle = window.requestAnimationFrame(step);
    };
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, stop, { passive: true });
    handle = window.requestAnimationFrame(step);
    return stop;
}

/**
 * Decides on mount whether this mount returns to the saved Day (Back, or the
 * flagged "Back to Calendar" button) and holds that target until it is applied.
 * While it waits, the user's first touch or wheel drops it for good.
 */
function usePendingDayScroll(date: string, isDayView: boolean): MutableRefObject<SavedDayScroll | null> {
    const navigationType = useNavigationType();
    const { state } = useLocation();
    const targetRef = useRef<SavedDayScroll | null>(null);
    const decidedRef = useRef(false);
    useEffect(() => {
        if (decidedRef.current) return;
        decidedRef.current = true;
        const saved = takeSavedDayScroll();
        const returning = navigationType === NavigationType.Pop || hasRestoreDayScrollFlag(state);
        if (saved && returning && isDayView && saved.date === date) targetRef.current = saved;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only, by design
    useEffect(() => {
        if (targetRef.current === null) return undefined;
        const drop = (): void => { targetRef.current = null; remove(); };
        const remove = (): void => { for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, drop); };
        for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, drop, { passive: true });
        return remove;
    }, []);
    return targetRef;
}

/**
 * Restores the saved Day-view offset when this mount came from Back (or the
 * flagged "Back to Calendar" button) onto the same date in Day view. The saved
 * entry is consumed on mount. The restore waits for `ready` (the grid's loading
 * block gone) so it lands on the final layout; a date or view change, or a
 * user scroll, before then cancels it for good. Skipped if the width is no
 * longer a phone's. The target is held until the first restore frame has
 * scrolled, so an effect cleanup + re-run (React StrictMode) before that frame
 * reschedules it instead of losing it; once applied it is never replayed.
 */
export function useDayViewScrollRestore(date: string, isDayView: boolean, ready: boolean = true): void {
    const targetRef = usePendingDayScroll(date, isDayView);
    useEffect(() => {
        const target = targetRef.current;
        if (target === null) return undefined;
        if (!isDayView || target.date !== date) { targetRef.current = null; return undefined; }
        if (!ready) return undefined;
        if (!isPhoneCalendarWidth()) { targetRef.current = null; return undefined; }
        const applied = (): void => { if (targetRef.current === target) targetRef.current = null; };
        return restoreWindowScroll(target.y, MAX_RESTORE_FRAMES, applied);
    }, [ready, date, isDayView, targetRef]);
}
