/**
 * ROK-1464 — pure day-bucketing for the LFG overlap strip.
 *
 * `GET /lfg/:gameId/overlap` returns offset-bearing instants that were already
 * reconciled across every member's own timezone. Rendering is therefore a
 * straight conversion into the VIEWER's local time — which is why a window can
 * legitimately land on two weekdays (23:00 → 01:00) and must be painted on
 * both.
 */
import type { LfgOverlapWindowDto } from '@raid-ledger/contract';

/** How much of the roster a day can field. */
export type OverlapDayStatus = 'none' | 'part' | 'hit';

/** One column of the Mon–Sun strip. */
export interface OverlapDay {
    label: string;
    status: OverlapDayStatus;
}

/** Mon-first so the strip reads like a week, not like `Date#getDay`. */
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_RANK: Record<OverlapDayStatus, number> = {
    none: 0,
    part: 1,
    hit: 2,
};

/** Monday-first weekday index for a local instant. */
function weekdayIndex(date: Date): number {
    return (date.getDay() + 6) % 7;
}

/** Local midnight for the calendar day a given instant falls in. */
function startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Every Monday-first weekday index a window touches in local time. A window
 * that crosses local midnight yields two (or more) indices.
 */
function touchedWeekdays(window: LfgOverlapWindowDto): number[] {
    const end = new Date(window.end);
    const indices: number[] = [];
    let cursor = startOfLocalDay(new Date(window.start));
    while (cursor.getTime() <= end.getTime() && indices.length < 7) {
        indices.push(weekdayIndex(cursor));
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return indices;
}

/**
 * A window is a `hit` only when the WHOLE live roster is free for it. Anything
 * else — including a zero-member roster — is a fallback window, never a
 * promise that everybody can make it.
 */
function statusFor(
    window: LfgOverlapWindowDto,
    memberCount: number,
): OverlapDayStatus {
    return memberCount > 0 && window.availableCount >= memberCount
        ? 'hit'
        : 'part';
}

/**
 * Build the seven Mon–Sun columns for the overlap strip.
 *
 * @param windows Ranked windows from `GET /lfg/:gameId/overlap`.
 * @param memberCount Live roster size the windows were computed against.
 */
export function buildDayStrip(
    windows: LfgOverlapWindowDto[],
    memberCount: number,
): OverlapDay[] {
    const strip: OverlapDay[] = DAY_LABELS.map((label) => ({
        label,
        status: 'none',
    }));
    for (const window of windows) {
        const status = statusFor(window, memberCount);
        for (const index of touchedWeekdays(window)) {
            if (STATUS_RANK[status] > STATUS_RANK[strip[index].status]) {
                strip[index].status = status;
            }
        }
    }
    return strip;
}

/**
 * The best windows to offer as "start a poll here" rows. The server already
 * ranks them, so this only caps the list — re-sorting would silently override
 * a ranking the client cannot reproduce.
 */
export function pickBestWindows(
    windows: LfgOverlapWindowDto[],
    max = 2,
): LfgOverlapWindowDto[] {
    return windows.slice(0, max);
}

/** `7`, `7:30`, optionally with the ` AM`/` PM` suffix. */
function clockLabel(date: Date, withMeridiem: boolean): string {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    const mins = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
    const meridiem = withMeridiem ? ` ${hours < 12 ? 'AM' : 'PM'}` : '';
    return `${hour12}${mins}${meridiem}`;
}

/**
 * `Wed 7–10 PM · 3 of 3 free` — the row label for one overlap window.
 * The opening meridiem is dropped when both ends share it.
 */
export function formatWindowLabel(window: LfgOverlapWindowDto): string {
    const start = new Date(window.start);
    const end = new Date(window.end);
    const sameMeridiem = start.getHours() < 12 === end.getHours() < 12;
    const day = DAY_LABELS[weekdayIndex(start)];
    const range = `${clockLabel(start, !sameMeridiem)}–${clockLabel(end, true)}`;
    return `${day} ${range} · ${window.availableCount} of ${window.totalCount} free`;
}
