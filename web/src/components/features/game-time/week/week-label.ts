import type { MemberCounts } from '../../../../pages/scheduling/availability-freshness';
import { cellInstant } from '../slot-marks.utils';

/** "Sep 20". */
function monthDay(at: Date): string {
    return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * The toolbar's range: "Sep 20 – 26", or "Sep 27 – Oct 3" when the week
 * crosses a month.
 *
 * @param weekStart Sunday 00:00 local.
 */
export function weekRangeLabel(weekStart: Date): string {
    const sat = cellInstant(weekStart, 6, 0);
    const end = sat.getMonth() === weekStart.getMonth() ? String(sat.getDate()) : monthDay(sat);
    return `${monthDay(weekStart)} – ${end}`;
}

/** A day column header's date: "Sep 23". */
export function dayHeaderDate(weekStart: Date, dayOfWeek: number): string {
    return monthDay(cellInstant(weekStart, dayOfWeek, 0));
}

/** Whether a day of the displayed week is today (local). */
export function isToday(weekStart: Date, dayOfWeek: number, now: Date = new Date()): boolean {
    return cellInstant(weekStart, dayOfWeek, 0).toDateString() === now.toDateString();
}

/**
 * "6 members · 4 fresh · 1 out of date · 1 unknown" — zero and absent clauses
 * are omitted; the total always reads.
 */
export function membersClause(counts: MemberCounts): string {
    const parts = [`${counts.total} ${counts.total === 1 ? 'member' : 'members'}`];
    if (counts.fresh) parts.push(`${counts.fresh} fresh`);
    if (counts.stale) parts.push(`${counts.stale} out of date`);
    if (counts.unknown) parts.push(`${counts.unknown} unknown`);
    return parts.join(' · ');
}
