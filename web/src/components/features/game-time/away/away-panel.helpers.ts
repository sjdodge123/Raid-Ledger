/**
 * Pure helpers for the "I'm away" panel (ROK-1585).
 *
 * All date math is LOCAL (see `absence-dates.utils.ts`): an absence is "the
 * days I'm away where I am", so parsing `YYYY-MM-DD` as UTC would shift every
 * label for anyone west of Greenwich.
 */
import { quickRange, spanLabel, toISODate, type QuickRangeKind } from '../absence-dates.utils';

/** The minimum shape the helpers need from an absence. */
export interface AbsenceLike {
    startDate: string;
    endDate: string;
}

/** Which quick-range chip the form's dates correspond to. */
export type AwayPick = QuickRangeKind | 'custom';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PRESETS: QuickRangeKind[] = ['weekend', 'next-week'];

function dayLabel(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Mon Sep 21 – Sun Sep 27", or "Sat Sep 19" for a one-day absence. */
export function awayRangeLabel(startDate: string, endDate: string): string {
    if (startDate === endDate) return dayLabel(startDate);
    return `${dayLabel(startDate)} – ${dayLabel(endDate)}`;
}

/** "7 days" / "2 days · Lake trip" — the row's secondary line. */
export function awayRowMeta(startDate: string, endDate: string, reason: string | null): string {
    const span = spanLabel(startDate, endDate);
    const note = reason?.trim();
    return note ? `${span} · ${note}` : span;
}

/** Absences that have not ended (one ending today still counts), sorted by start. */
export function upcomingAbsences<T extends AbsenceLike>(absences: readonly T[], today: Date): T[] {
    const todayIso = toISODate(today);
    return absences
        .filter((a) => a.endDate >= todayIso)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** "Sat Sep 19 – Sun Sep 20 · +1 more" for the entry row, or null when nothing is booked. */
export function nextAwayLabel(absences: readonly AbsenceLike[], today: Date): string | null {
    const [next, ...rest] = upcomingAbsences(absences, today);
    if (!next) return null;
    const label = awayRangeLabel(next.startDate, next.endDate);
    return rest.length > 0 ? `${label} · +${rest.length} more` : label;
}

/**
 * Which preset the current dates correspond to — derived, never stored, so a
 * hand-edited date flips the chips to Custom (moved from `game-time-absence.tsx`).
 */
export function activePick(startDate: string, endDate: string, today: Date): AwayPick | null {
    if (!startDate && !endDate) return null;
    const hit = PRESETS.find((kind) => {
        const r = quickRange(kind, today);
        return r.startDate === startDate && r.endDate === endDate;
    });
    return hit ?? 'custom';
}
