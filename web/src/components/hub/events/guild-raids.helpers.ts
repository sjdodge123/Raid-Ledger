/**
 * ROK-1787 — pure formatting for the guild Raids widgets. Every time is shown
 * in the viewer's local time zone (the browser's), never the server's.
 */
import type { GuildEventCardDto } from '@raid-ledger/contract';

/** `attended` of `of` as a whole percentage; 0 when there is nothing to divide by. */
export function percent(part: number, whole: number): number {
    if (whole <= 0) return 0;
    return Math.round((part / whole) * 100);
}

/** "Tue" */
export function weekdayShort(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
}

/** "8:00 PM" */
export function timeShort(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "8:00 PM – 11:00 PM" */
export function timeRange(startIso: string, endIso: string): string {
    return `${timeShort(startIso)} – ${timeShort(endIso)}`;
}

/** Date tile parts: { month: "OCT", day: "14" }. */
export function dateTile(iso: string): { month: string; day: string } {
    const d = new Date(iso);
    return { month: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(), day: String(d.getDate()) };
}

/** "Tue, Oct 14" */
export function dayLabel(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Tue, Oct 14 · 8:00 PM" */
export function whenLabel(iso: string): string {
    return `${dayLabel(iso)} · ${timeShort(iso)}`;
}

/** "3 / 20 signed up", or "3 signed up" when the event is uncapped. */
export function signupLabel(e: Pick<GuildEventCardDto, 'signupCount' | 'needed'>): string {
    return e.needed === null ? `${e.signupCount} signed up` : `${e.signupCount} / ${e.needed} signed up`;
}

/** Hero chip count: "3/20 signed" or "3 signed". */
export function signedShort(e: Pick<GuildEventCardDto, 'signupCount' | 'needed'>): string {
    return e.needed === null ? `${e.signupCount} signed` : `${e.signupCount}/${e.needed} signed`;
}
