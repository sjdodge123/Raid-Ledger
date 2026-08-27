/**
 * Date helpers for the absence form (ROK-1426).
 *
 * Absences are stored as inclusive calendar ranges, so a Saturday-to-Sunday
 * trip is two days, not one. Everything here works in LOCAL time and formats
 * with local getters — an absence is "the days I'm away" where the user is, so
 * a UTC round-trip would shift the range for anyone west of Greenwich.
 */
export type QuickRangeKind = 'weekend' | 'next-week';

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Local-time YYYY-MM-DD, the shape both the date input and the API expect. */
export function toISODate(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
}

/**
 * Presets for the two cases that cover most absences.
 *
 * "This weekend" is the coming Sat-Sun, and stays on today when today IS
 * Saturday. "Next week" is always the NEXT Monday-Sunday, so asking for it on a
 * Monday gives the following week rather than the day you're standing in.
 */
export function quickRange(kind: QuickRangeKind, today: Date): { startDate: string; endDate: string } {
    if (kind === 'weekend') {
        const saturday = addDays(today, (6 - today.getDay() + 7) % 7);
        return { startDate: toISODate(saturday), endDate: toISODate(addDays(saturday, 1)) };
    }
    const monday = addDays(today, ((1 - today.getDay() + 7) % 7) || 7);
    return { startDate: toISODate(monday), endDate: toISODate(addDays(monday, 6)) };
}

/** Inclusive day count for a range, or 0 when it is empty or inverted. */
export function spanDays(startDate: string, endDate: string): number {
    if (!startDate || !endDate) return 0;
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return diff < 0 ? 0 : diff + 1;
}

/** "3 days" / "1 day", or an empty string when there is nothing to count. */
export function spanLabel(startDate: string, endDate: string): string {
    const days = spanDays(startDate, endDate);
    if (days === 0) return '';
    return `${days} ${days === 1 ? 'day' : 'days'}`;
}
