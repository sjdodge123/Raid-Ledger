import { useEffect } from 'react';
import { NavigationType, useNavigationType } from 'react-router-dom';
import { isPhoneCalendarWidth } from './phone-calendar-width';

/**
 * ROK-2303: on a phone the Day view scrolls the window (`.rbc-time-content` is
 * `overflow: visible`), and the page remounts when Back returns from an event,
 * so the browser's own restore runs before the grid is tall enough. Opening an
 * event from the phone Day view saves the window offset here; the next mount
 * reached by Back (a POP) on the same date in Day view puts it back. Any other
 * mount just drops the saved offset.
 */
const STORAGE_KEY = 'rl:calendar-day-scroll';
const MAX_RESTORE_FRAMES = 30;

interface SavedDayScroll {
    date: string;
    y: number;
}

/** Called when an event is opened from the Day view; a no-op at tablet/desktop width. */
export function rememberDayViewScroll(date: string): void {
    if (!isPhoneCalendarWidth()) return;
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ date, y: window.scrollY }));
    } catch {
        // Storage blocked (private mode): Back simply opens at the top.
    }
}

function takeSavedDayScroll(): SavedDayScroll | null {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || !('date' in parsed) || !('y' in parsed)) return null;
        const { date, y } = parsed;
        return typeof date === 'string' && typeof y === 'number' ? { date, y } : null;
    } catch {
        return null;
    }
}

/**
 * Scrolls the window to `y` on the next frames until it sticks (the grid may
 * still be growing) or the frame budget runs out. Returns a cancel function.
 */
export function restoreWindowScroll(y: number, maxFrames: number = MAX_RESTORE_FRAMES): () => void {
    let frame = 0;
    let handle = 0;
    const step = (): void => {
        window.scrollTo(window.scrollX, y);
        frame += 1;
        if (Math.abs(window.scrollY - y) <= 1 || frame >= maxFrames) return;
        handle = window.requestAnimationFrame(step);
    };
    handle = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(handle);
}

/**
 * Mount-only: restores the saved Day-view offset when this mount came from
 * Back/Forward onto the same date in Day view. Later date or view changes
 * never restore, because the saved entry is consumed on mount.
 */
export function useDayViewScrollRestore(date: string, isDayView: boolean): void {
    const navigationType = useNavigationType();
    useEffect(() => {
        const saved = takeSavedDayScroll();
        if (!saved || navigationType !== NavigationType.Pop || !isDayView || saved.date !== date) return undefined;
        return restoreWindowScroll(saved.y);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only, by design
}
