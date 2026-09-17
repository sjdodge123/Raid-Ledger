import type { HeatmapCellData } from './game-time-grid.types';
import { DAYS } from './game-time-grid.utils';
import { groupCellKey } from './phone/group-day.utils';

/**
 * Pure helpers for the "already suggested" marks and the week-columns cell copy
 * (ROK-1587 phone day view, ROK-1588 desktop week view + Reschedule).
 *
 * Local-time semantics throughout: a slot lands on `getDay()` / `getHours()` of
 * its instant, and a cell's instant is built with local `setDate` / `setHours`
 * — the same math as `toDatetimeLocal`, so a DST week never shifts an hour.
 */

/** One outlined hour: a poll slot (or several) starting in it, votes summed. */
export interface SlotMark {
    dayOfWeek: number;
    hour: number;
    votes: number;
}

/** The slice of a poll slot the marks need. */
export interface SlotLike {
    proposedTime: string;
    votes: unknown[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * The local instant of one cell of the displayed week.
 *
 * @param weekStart Sunday 00:00 local of the displayed week (not mutated).
 * @param dayOfWeek 0 = Sunday … 6 = Saturday.
 * @param hour 0–23 wall-clock hour.
 */
export function cellInstant(weekStart: Date, dayOfWeek: number, hour: number): Date {
    const at = new Date(weekStart);
    at.setDate(at.getDate() + dayOfWeek);
    at.setHours(hour, 0, 0, 0);
    return at;
}

/**
 * Poll slots starting in `[weekStart, weekStart + 7 days)`, keyed by
 * `groupCellKey`. Two slots in the same hour become one mark with their votes
 * summed; a slot with no votes is kept (it still exists and is outlined).
 */
export function slotMarksForWeek(slots: SlotLike[], weekStart: Date): Map<string, SlotMark> {
    const weekEnd = cellInstant(weekStart, 7, 0);
    const marks = new Map<string, SlotMark>();
    for (const slot of slots) {
        const at = new Date(slot.proposedTime);
        if (at < weekStart || at >= weekEnd) continue;
        const key = groupCellKey(at.getDay(), at.getHours());
        const existing = marks.get(key);
        if (existing) existing.votes += slot.votes.length;
        else marks.set(key, { dayOfWeek: at.getDay(), hour: at.getHours(), votes: slot.votes.length });
    }
    return marks;
}

/** Marks per day of the week (index 0 = Sunday), for the phone week strip's "● N". */
export function slotCountsByDay(marks: Map<string, SlotMark>): number[] {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const mark of marks.values()) counts[mark.dayOfWeek] += 1;
    return counts;
}

/** "0 voted" / "1 voted" / "N voted" — the slot chip and aria clause. */
export function votedLabel(votes: number): string {
    return `${votes} voted`;
}

/** "9 PM", "12 AM", "12 PM". */
function hourLabel(hour: number): string {
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * A cell's time for CTA / note copy: "Wed 9 PM", or "Wed Sep 23, 9 PM" with
 * `withDate`.
 */
export function cellTimeLabel(weekStart: Date, dayOfWeek: number, hour: number, withDate = false): string {
    if (!withDate) return `${DAYS[dayOfWeek]} ${hourLabel(hour)}`;
    const at = cellInstant(weekStart, dayOfWeek, hour);
    return `${DAYS[dayOfWeek]} ${MONTHS[at.getMonth()]} ${at.getDate()}, ${hourLabel(hour)}`;
}

/** Flags that append clauses to a cell's aria-label. */
export interface GroupCellAriaExtras {
    votes?: number;
    picked?: boolean;
    current?: boolean;
}

/** The count clauses: freshness ("5 free", "1 stale", "1 busy") or legacy ("4 of 5 free"). */
function countClauses(cell: HeatmapCellData | undefined): string[] {
    if (!cell) return ['no data'];
    if (cell.stale === undefined && cell.unknown === undefined) {
        return [`${cell.available} of ${cell.total} free`];
    }
    const clauses = [`${cell.available} free`];
    if ((cell.stale ?? 0) > 0) clauses.push(`${cell.stale} stale`);
    if ((cell.busy ?? 0) > 0) clauses.push(`${cell.busy} busy`);
    return clauses;
}

/** The mark clauses, in reading order; zero-count and false flags are omitted. */
function extraClauses(extras: GroupCellAriaExtras): string[] {
    const clauses: string[] = [];
    if (extras.votes !== undefined) clauses.push(votedLabel(extras.votes));
    if (extras.picked) clauses.push('suggested');
    if (extras.current) clauses.push('current time');
    return clauses;
}

/**
 * The desktop week cell's aria-label: "Wed 8 PM: 5 free, 1 stale, 1 busy,
 * 2 voted" for the poll's freshness aggregate, "Wed 8 PM: 4 of 5 free" for the
 * legacy (events) aggregate, "Wed 8 PM: no data" for a missing cell; then
 * "", suggested" / ", current time" as flagged.
 *
 * The phone keeps `computeHeatmapLabel` copy (smoke regexes key on it).
 */
export function groupCellAriaLabel(
    dayOfWeek: number, hour: number, cell: HeatmapCellData | undefined, extras: GroupCellAriaExtras,
): string {
    const clauses = [...countClauses(cell), ...extraClauses(extras)];
    return `${DAYS[dayOfWeek]} ${hourLabel(hour)}: ${clauses.join(', ')}`;
}
