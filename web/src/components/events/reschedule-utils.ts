import { getWeekStart } from '../lineups/cycle-4/scheduling-availability';
import { cellInstant } from '../features/game-time/slot-marks.utils';
import type { WeekCellRef } from '../features/game-time/week/GroupWeekView';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const DURATION_PRESETS = [
    { label: '1h', minutes: 60 },
    { label: '1.5h', minutes: 90 },
    { label: '2h', minutes: 120 },
    { label: '3h', minutes: 180 },
    { label: '4h', minutes: 240 },
] as const;

export function formatHour(hour: number): string {
    if (hour === 0 || hour === 24) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    return hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
}

/**
 * Convert a Date to a `datetime-local` input value (YYYY-MM-DDThh:mm)
 */
export function toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The confirm button's copy: "Move to Wed Sep 23, 9 PM" ("9:30 PM" off the hour); "Confirm" without a start. */
export function moveToLabel(at: Date | null): string {
    if (!at || Number.isNaN(at.getTime())) return 'Confirm';
    const hour = at.getHours() % 12 || 12;
    const minutes = at.getMinutes() ? `:${String(at.getMinutes()).padStart(2, '0')}` : '';
    const meridiem = at.getHours() < 12 ? 'AM' : 'PM';
    return `Move to ${SHORT_DAYS[at.getDay()]} ${MONTHS[at.getMonth()]} ${at.getDate()}, ${hour}${minutes} ${meridiem}`;
}

/** The cell `at` falls in, when it lies inside the displayed week. */
export function cellInWeek(at: Date | null, weekStart: Date): WeekCellRef | null {
    if (!at || Number.isNaN(at.getTime())) return null;
    if (getWeekStart(at).getTime() !== weekStart.getTime()) return null;
    return { dayOfWeek: at.getDay(), hour: at.getHours() };
}

/** Past hours and the event's own start hour cannot be picked. */
export function isCellBlocked(weekStart: Date, currentStart: Date, day: number, hour: number): boolean {
    const at = cellInstant(weekStart, day, hour).getTime();
    if (at <= Date.now()) return true;
    const current = new Date(currentStart);
    current.setMinutes(0, 0, 0);
    return at === current.getTime();
}
