import type { CalendarProvider, GameTimeCalendarBusy, GameTimeSlot } from '@raid-ledger/contract';
import { PROVIDER_CALENDAR_NAME } from '../calendar-sync/calendar-sync.copy';
import { isSlotActive } from './game-time-slot.utils';

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

/**
 * Every visible busy run on the given days. Ranges are unioned per day first
 * (two picked calendars both busy at 8 PM, or 7–9 PM next to 9–10 PM), so an
 * overlap draws ONE band — no duplicate key, no stacked darker fill. A day's
 * runs take the provider of its first range (one provider ships today).
 */
export function busyRunsForDays(
    busy: readonly GameTimeCalendarBusy[], days: readonly number[], hours: readonly number[],
): BusyRun[] {
    const byDay = new Map<number, { provider: CalendarProvider; indices: Set<number> }>();
    for (const b of busy) {
        if (!days.includes(b.dayOfWeek)) continue;
        const entry = byDay.get(b.dayOfWeek) ?? { provider: b.provider, indices: new Set<number>() };
        for (const i of rangeHours(b).map((h) => hours.indexOf(h))) if (i >= 0) entry.indices.add(i);
        byDay.set(b.dayOfWeek, entry);
    }
    return [...byDay].flatMap(([dayOfWeek, { provider, indices }]) =>
        contiguousRuns([...indices].sort((x, y) => x - y)).map(([startIndex, endIndex]) => ({
            dayOfWeek, startIndex, endIndex, provider,
        })));
}

/**
 * "Nh busy" for the day header (spec S2: busy hours ∩ the day's slots): the
 * distinct visible hours of one day that the viewer marked free AND a synced
 * busy range covers. A busy hour outside every free slot is not counted —
 * it costs the viewer no game time. Overlapping ranges count once.
 */
export function busyHourCount(
    busy: readonly GameTimeCalendarBusy[], slots: readonly GameTimeSlot[],
    dayOfWeek: number, hours: readonly number[],
): number {
    const visible = new Set(hours);
    const free = new Set(slots.filter((s) => s.dayOfWeek === dayOfWeek && isSlotActive(s)).map((s) => s.hour));
    const covered = new Set(
        busy.filter((b) => b.dayOfWeek === dayOfWeek).flatMap(rangeHours).filter((h) => visible.has(h) && free.has(h)),
    );
    return covered.size;
}

/** The band's label — "Busy · Google Calendar". */
export function busyBandLabel(provider: CalendarProvider): string {
    return `Busy · ${PROVIDER_CALENDAR_NAME[provider]}`;
}
