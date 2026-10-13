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
import type { AwaySource } from '../away/away-row.types';

/**
 * The strip's away days: a plain set (every day manual), or each day's source
 * from {@link awaySourcesOfWeek} so a synced day gets the calendar tile (S2).
 */
export type AwayDays = ReadonlySet<number> | ReadonlyMap<number, AwaySource>;

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

/**
 * Which kind of absence covers the date, or null. Manual wins over calendar —
 * the viewer's own booking is the stronger fact. No `source` = manual.
 */
function coverSource(absences: readonly GameTimeAbsence[], key: string): AwaySource | null {
    let hit: AwaySource | null = null;
    for (const a of absences) {
        if (key < a.startDate || a.endDate < key) continue;
        if ((a.source ?? 'manual') === 'manual') return 'manual';
        hit = 'calendar';
    }
    return hit;
}

/**
 * {@link awayDaysOfWeek} with each away day's source (ROK-1595 S2): the phone
 * strip draws a synced day in the calendar style.
 *
 * @returns Day of the week (0 = Sunday) → `manual` | `calendar`, away days only.
 */
export function awaySourcesOfWeek(absences: readonly GameTimeAbsence[], today: Date): Map<number, AwaySource> {
    const days = new Map<number, AwaySource>();
    for (let d = 0; d < 7; d++) {
        const source = coverSource(absences, localDateKey(addDays(today, (d - today.getDay() + 7) % 7)));
        if (source) days.set(d, source);
    }
    return days;
}

/** A strip day's away source, or null when it is not away. A plain set means manual. */
export function awaySourceOf(days: AwayDays | undefined, d: number): AwaySource | null {
    if (!days?.has(d)) return null;
    return 'get' in days ? days.get(d) ?? 'manual' : 'manual';
}
