/**
 * Which days of a week the viewer is away (ROK-1585).
 *
 * Absences are booked as local calendar dates (`YYYY-MM-DD`, both ends
 * inclusive). The phone strip and the desktop day headers only know days of the
 * week, so both helpers resolve each weekday to one concrete date first and then
 * ask whether any absence covers it. ISO date strings compare correctly as
 * strings, so no timezone arithmetic is involved.
 */
import type { GameTimeAbsence } from '@raid-ledger/contract';

/** A local date as `YYYY-MM-DD`, the shape absences are stored in. */
function localDateKey(date: Date): string {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
}

/** `base` moved by whole local days (month ends and DST safe). */
function addDays(base: Date, days: number): Date {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/** Whether any absence covers the date, ends inclusive. */
function isCovered(absences: readonly GameTimeAbsence[], key: string): boolean {
    return absences.some((a) => a.startDate <= key && key <= a.endDate);
}

/** The weekdays (0 = Sunday) whose resolved date is covered by an absence. */
function awaySet(absences: readonly GameTimeAbsence[], dateOf: (dayOfWeek: number) => Date): Set<number> {
    const days = new Set<number>();
    if (absences.length === 0) return days;
    for (let d = 0; d < 7; d++) {
        if (isCovered(absences, localDateKey(dateOf(d)))) days.add(d);
    }
    return days;
}

/**
 * Away days for the phone week strip: the next seven days starting today.
 *
 * Strip day `d` is the date `today + ((d - today.getDay() + 7) % 7)` — so on a
 * Saturday, the strip's Sunday is TOMORROW, not last Sunday.
 *
 * @param absences The viewer's booked absences.
 * @param today The viewer's local "now".
 * @returns Days of the week (0 = Sunday … 6 = Saturday) that are away.
 */
export function awayDaysOfWeek(absences: readonly GameTimeAbsence[], today: Date): Set<number> {
    return awaySet(absences, (d) => addDays(today, (d - today.getDay() + 7) % 7));
}

/**
 * Away days for a displayed Sun–Sat week (the desktop profile grid's headers).
 *
 * @param absences The viewer's booked absences.
 * @param weekStart The Sunday the displayed week starts on (local date).
 * @returns Days of the week (0 = Sunday … 6 = Saturday) that are away.
 */
export function awayDatesInWeek(absences: readonly GameTimeAbsence[], weekStart: Date): Set<number> {
    return awaySet(absences, (d) => addDays(weekStart, d));
}
