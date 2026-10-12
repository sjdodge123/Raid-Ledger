/**
 * Pure helpers for the "I'm away" panel (ROK-1585).
 *
 * All date math is LOCAL (see `absence-dates.utils.ts`): an absence is "the
 * days I'm away where I am", so parsing `YYYY-MM-DD` as UTC would shift every
 * label for anyone west of Greenwich.
 */
import type { CalendarProvider, CalendarsOverview } from '@raid-ledger/contract';
import { PROVIDER_CALENDAR_NAME } from '../../calendar-sync/calendar-sync.copy';
import { quickRange, spanLabel, toISODate, type QuickRangeKind } from '../absence-dates.utils';
import type { AwayRowItem, AwaySource } from './away-row.types';

/** The minimum shape the helpers need from an absence. */
export interface AbsenceLike {
    startDate: string;
    endDate: string;
    /** ROK-1595: absent = manual. */
    source?: AwaySource | undefined;
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

/**
 * A synced row's secondary line (ROK-1595 S1): "4 days · Google Calendar", or
 * "All day · Google Calendar" for a one-day absence. The provider stands in
 * for the note — a synced day never has one.
 */
export function calendarRowMeta(startDate: string, endDate: string, provider: CalendarProvider | null): string {
    const span = startDate === endDate ? 'All day' : spanLabel(startDate, endDate);
    return `${span} · ${provider ? PROVIDER_CALENDAR_NAME[provider] : 'Your calendar'}`;
}

/** The secondary line for any row, by source. */
export function rowMeta(row: AwayRowItem): string {
    if (row.source === 'calendar') return calendarRowMeta(row.startDate, row.endDate, row.provider);
    return awayRowMeta(row.startDate, row.endDate, row.reason);
}

/** Absences that have not ended (one ending today still counts), sorted by start. */
export function upcomingAbsences<T extends AbsenceLike>(absences: readonly T[], today: Date): T[] {
    const todayIso = toISODate(today);
    return absences
        .filter((a) => a.endDate >= todayIso)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * "Sat Sep 19 – Sun Sep 20 · +1 more" for the entry row, or null when nothing
 * is booked. A synced first row reads "… · from calendar · +1 more" (S2).
 */
export function nextAwayLabel(absences: readonly AbsenceLike[], today: Date): string | null {
    const [next, ...rest] = upcomingAbsences(absences, today);
    if (!next) return null;
    const from = next.source === 'calendar' ? ' · from calendar' : '';
    const more = rest.length > 0 ? ` · +${rest.length} more` : '';
    return `${awayRangeLabel(next.startDate, next.endDate)}${from}${more}`;
}

/**
 * The newest `lastSyncedAt` among connections that read a calendar, or null —
 * kill switch off (`enabled: false`), nothing reading, or never synced.
 */
export function newestReadSync(overview: CalendarsOverview | undefined): string | null {
    if (!overview?.enabled) return null;
    const times = overview.connections.flatMap((c) => (c.read.enabled && c.lastSyncedAt ? [Date.parse(c.lastSyncedAt)] : []));
    const newest = Math.max(...times.filter((t) => !Number.isNaN(t)));
    return Number.isFinite(newest) ? new Date(newest).toISOString() : null;
}

/** "Synced 4 min ago" for the calendar group's divider; null when there is no sync time. */
export function syncedAgoLabel(iso: string | null, nowMs: number): string | null {
    const at = iso ? Date.parse(iso) : Number.NaN;
    if (Number.isNaN(at)) return null;
    const mins = Math.max(0, Math.floor((nowMs - at) / 60_000));
    if (mins < 1) return 'Synced just now';
    if (mins < 60) return `Synced ${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Synced ${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `Synced ${days} day${days === 1 ? '' : 's'} ago`;
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
