import type { CommunityTemporalResponseDto } from '@raid-ledger/contract';

type PeakHours = CommunityTemporalResponseDto['peakHours'];

/** Weekday short names, index 0 = weekday 1 (Monday) … index 6 = weekday 7 (Sunday). */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Peak-cell marker (ROK-1936): an inset `foreground` ring — white on the dark
 * families, near-black on the light ones — so it reads over every shade of the
 * green activity fill. `ring-inset` paints inside the cell, so the 7×24 grid
 * keeps its size and the phone layout does not overflow.
 */
export const PEAK_MARK = 'ring-2 ring-inset ring-foreground';

/** Cell key shared by the heatmap lookup maps. */
export function cellKey(weekday: number, hour: number): string {
    return `${weekday}:${hour}`;
}

/**
 * 12-hour clock label for a 0–23 hour: 0 → "12am", 12 → "12pm", 21 → "9pm".
 */
export function formatHour12(hour: number): string {
    const suffix = hour < 12 ? 'am' : 'pm';
    const h = hour % 12 === 0 ? 12 : hour % 12;
    return `${h}${suffix}`;
}

/** Tooltip text for a peak cell, e.g. "Sat 9pm · 17 sessions". */
export function peakCellLabel(dayLabel: string, hour: number, activity: number): string {
    return `${dayLabel} ${formatHour12(hour)} · ${sessionsLabel(activity)}`;
}

/** Index each weekday's top hours by cell key → that hour's session count. */
export function buildPeakMap(peakHours: PeakHours): Map<string, number> {
    return new Map(peakHours.map((p) => [cellKey(p.weekday, p.hour), p.activity]));
}

/** "1 session" / "3 sessions". */
export function sessionsLabel(count: number): string {
    return `${count} ${count === 1 ? 'session' : 'sessions'}`;
}
