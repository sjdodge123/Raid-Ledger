import type { CalendarProvider, GameTimeCalendarBusy } from '@raid-ledger/contract';
import { PROVIDER_CALENDAR_NAME } from '../calendar-sync/calendar-sync.copy';

/**
 * Pure helpers for the viewer's own-calendar busy band (ROK-1595 S2, NP-1).
 *
 * `calendarBusy.dayOfWeek` is already in the grid's DISPLAY convention
 * (0 = Sunday, `game-time.schema.ts` R4), so it is compared to the grid's day
 * index as-is — never shifted from the DB's 0 = Monday. Hours are mapped into
 * the caller's visible-hours index space, the same space the block layer uses,
 * so a window that wraps past midnight still lines up.
 */

/** One contiguous stretch of a busy range inside the visible window. */
export interface BusyRun {
    dayOfWeek: number;
    /** Inclusive index into the caller's `hours`. */
    startIndex: number;
    /** Exclusive index into the caller's `hours`. */
    endIndex: number;
    provider: CalendarProvider;
}

/** The 0..23 hours a range covers (`endHour` is exclusive, 24 = end of day). */
function rangeHours(b: GameTimeCalendarBusy): number[] {
    return Array.from({ length: Math.max(0, b.endHour - b.startHour) }, (_, i) => b.startHour + i);
}

/** Group sorted indices into [start, end) runs of consecutive values. */
function contiguousRuns(indices: number[]): Array<[number, number]> {
    const runs: Array<[number, number]> = [];
    for (const i of indices) {
        const last = runs[runs.length - 1];
        if (last && last[1] === i) last[1] = i + 1;
        else runs.push([i, i + 1]);
    }
    return runs;
}

/** Every visible run of every busy range on the given days. */
export function busyRunsForDays(
    busy: readonly GameTimeCalendarBusy[], days: readonly number[], hours: readonly number[],
): BusyRun[] {
    return busy.flatMap((b) => {
        if (!days.includes(b.dayOfWeek)) return [];
        const indices = rangeHours(b).map((h) => hours.indexOf(h)).filter((i) => i >= 0).sort((x, y) => x - y);
        return contiguousRuns(indices).map(([startIndex, endIndex]) => ({
            dayOfWeek: b.dayOfWeek, startIndex, endIndex, provider: b.provider,
        }));
    });
}

/** Distinct visible hours of one day covered by any busy range. */
export function busyHourCount(
    busy: readonly GameTimeCalendarBusy[], dayOfWeek: number, hours: readonly number[],
): number {
    const visible = new Set(hours);
    const covered = new Set(
        busy.filter((b) => b.dayOfWeek === dayOfWeek).flatMap(rangeHours).filter((h) => visible.has(h)),
    );
    return covered.size;
}

/** The S4 event-block sub-line — "You're in · also on Google Calendar" (desktop only, F-3). */
export function calendarCopyLabel(provider: CalendarProvider): string {
    return `You're in · also on ${PROVIDER_CALENDAR_NAME[provider]}`;
}

/** The band's label — "Busy · Google Calendar". */
export function busyBandLabel(provider: CalendarProvider): string {
    return `Busy · ${PROVIDER_CALENDAR_NAME[provider]}`;
}
