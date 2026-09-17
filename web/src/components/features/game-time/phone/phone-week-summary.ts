/**
 * One line that says what week is saved (ROK-1579).
 *
 * The phone profile shows a summary card and opens the editor in the drawer,
 * so the card needs the week in words: "Mon–Fri 7–10 PM", "Tue, Thu 8 PM–12 AM",
 * "No game time yet" — plus "Away Sep 17–19" when absences are booked.
 *
 * Pure, so it is unit-testable and neither mount has to re-derive it.
 */
import type { GameTimeAbsence, GameTimeSlot } from '@raid-ledger/contract';
import { DAYS } from '../game-time-grid.utils';
import { isSlotActive } from '../game-time-slot.utils';

/** What the card says when the viewer has never set a week. */
export const NO_WEEK = 'No game time yet';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Sort key: 0–5 is the tail of the previous evening, not the start of the day. */
const pos = (hour: number): number => (hour < 6 ? hour + 24 : hour);

/** "7 PM" / "12 AM", from a position that may run past 24. */
function clock(at: number): string {
    const h = at % 24;
    return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Contiguous runs of `values`, as [start, end] pairs (end inclusive). */
function runs(values: number[]): Array<[number, number]> {
    return values.reduce<Array<[number, number]>>((acc, v) => {
        const last = acc[acc.length - 1];
        if (last && v === last[1] + 1) last[1] = v;
        else acc.push([v, v]);
        return acc;
    }, []);
}

/** "7–10 PM" when the meridiem holds, "8 PM–12 AM" when it turns over. */
function hoursLabel(positions: number[]): string {
    return runs(positions)
        .map(([from, to]) => {
            const [a, b] = [clock(from), clock(to + 1)];
            const [ha, ma] = a.split(' ');
            return ma === b.split(' ')[1] ? `${ha}–${b}` : `${a}–${b}`;
        })
        .join(', ');
}

/** "Mon–Fri" for a run of three or more, otherwise "Tue, Thu". */
function daysLabel(days: number[]): string {
    return runs(days)
        .map(([from, to]) =>
            to - from >= 2
                ? `${DAYS[from]}–${DAYS[to]}`
                : Array.from({ length: to - from + 1 }, (_, i) => DAYS[from + i]).join(', '),
        )
        .join(', ');
}

/**
 * The saved week in words.
 *
 * @param slots The viewer's template slots (`useGameTime().data.slots`).
 * @returns e.g. `Mon–Fri 7–10 PM; Sat 2–6 PM`, or `No game time yet`.
 */
export function summariseWeek(slots: readonly GameTimeSlot[]): string {
    const byDay = new Map<number, number[]>();
    for (const s of slots) {
        if (!isSlotActive(s) || s.fromTemplate === false) continue;
        byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) ?? []), pos(s.hour)]);
    }
    const shape = new Map<string, number[]>();
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
        const key = [...new Set(byDay.get(day))].sort((a, b) => a - b).join(',');
        shape.set(key, [...(shape.get(key) ?? []), day]);
    }
    if (shape.size === 0) return NO_WEEK;
    return [...shape.entries()]
        .map(([key, days]) => `${daysLabel(days)} ${hoursLabel(key.split(',').map(Number))}`)
        .join('; ');
}

/** "Sep 17" / "Sep 17–19" / "Sep 30–Oct 2", parsed without a timezone. */
function rangeLabel(startDate: string, endDate: string): string {
    const [, sm, sd] = startDate.split('-').map(Number);
    const [, em, ed] = endDate.split('-').map(Number);
    const from = `${MONTHS[sm - 1]} ${sd}`;
    if (startDate === endDate) return from;
    return sm === em ? `${from}–${ed}` : `${from}–${MONTHS[em - 1]} ${ed}`;
}

/**
 * The absence line for the summary card.
 *
 * @param absences The viewer's booked absences (`useGameTime().data.absences`).
 * @returns e.g. `Away Sep 17–19 +1 more`, or `null` when there are none.
 */
export function summariseAbsences(absences: readonly GameTimeAbsence[]): string | null {
    if (absences.length === 0) return null;
    const [first, ...rest] = [...absences].sort((a, b) => a.startDate.localeCompare(b.startDate));
    return `Away ${rangeLabel(first.startDate, first.endDate)}${rest.length ? ` +${rest.length} more` : ''}`;
}

/** "confirmed today" / "confirmed yesterday" / "confirmed 5 days ago"; `null` = never. */
export function freshnessLabel(ageDays: number | null | undefined): string | null {
    if (ageDays === null || ageDays === undefined) return null;
    if (ageDays <= 0) return 'confirmed today';
    if (ageDays === 1) return 'confirmed yesterday';
    return `confirmed ${ageDays} days ago`;
}

/**
 * The Game Time nav row's subtitle — the saved week plus how fresh it is. Shared
 * by the phone More drawer and the desktop profile sidebar (ROK-1585 AC4b).
 *
 * @param slots The viewer's template slots (`useGameTime().data.slots`).
 * @param ageDays Whole days since the last confirmation; `null` = never.
 * @param empty What to say when no week is saved (each mount words it its own way).
 * @returns e.g. `Tue, Thu 7–10 PM · confirmed 2 days ago`, or `empty`.
 */
export function gameTimeSummary(
    slots: readonly GameTimeSlot[], ageDays: number | null | undefined, empty = 'nothing saved yet',
): string {
    const week = summariseWeek(slots);
    if (week === NO_WEEK) return empty;
    const fresh = freshnessLabel(ageDays);
    return fresh ? `${week} \u00B7 ${fresh}` : week;
}
