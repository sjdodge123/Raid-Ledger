import type { GameTimeSlot } from '@raid-ledger/contract';
import { isSlotActive } from '../game-time-slot.utils';
import { FULL_DAYS } from '../game-time-grid.utils';

/**
 * Pure helpers for the phone week editor (ROK-1569).
 *
 * The phone editor shows ONE day at a time, so everything here is scoped to a
 * single `dayOfWeek` in the app's grid convention (0 = Sunday) and to the
 * caller's visible-hours array — the same index space the block model uses.
 */

/** Minimum horizontal travel, in px, before a drag counts as a day swipe. */
export const SWIPE_DISTANCE = 70;
/** A swipe must be this many times more horizontal than vertical; else it is a scroll. */
export const SWIPE_RATIO = 1.5;

/** How many of the visible hours the viewer has marked free on one day. */
export function freeHourCount(slots: GameTimeSlot[], dayOfWeek: number, hours: number[]): number {
    const visible = new Set(hours);
    return slots.filter((s) => s.dayOfWeek === dayOfWeek && visible.has(s.hour) && isSlotActive(s)).length;
}

/** Header summary for one day — "3h free", or an invitation when it is empty. */
export function dayFreeLabel(freeHours: number): string {
    return freeHours > 0 ? `${freeHours}h free` : 'nothing yet';
}

/**
 * Screen-reader label for a week-strip column. Spelled out rather than
 * abbreviated: the strip's visible text is a single letter, which a screen
 * reader would otherwise announce as "T".
 */
export function dayStripLabel(dayOfWeek: number, freeHours: number): string {
    if (freeHours === 0) return `${FULL_DAYS[dayOfWeek]}, no hours free`;
    return `${FULL_DAYS[dayOfWeek]}, ${freeHours} hour${freeHours === 1 ? '' : 's'} free`;
}

/** Keep a day index inside Sunday..Saturday. The week does NOT wrap — paging past the end is a no-op. */
export function clampDay(day: number): number {
    return Math.max(0, Math.min(6, day));
}

/**
 * Days to step for a finished drag: +1 (leftward = later day), -1, or 0.
 *
 * A drag that is mostly vertical is the page scrolling, so it must never also
 * change the day — the same rule the ROK-1426 editor uses to stay `pan-y`.
 */
export function swipeStep(dx: number, dy: number): number {
    if (Math.abs(dx) <= SWIPE_DISTANCE || Math.abs(dx) <= Math.abs(dy) * SWIPE_RATIO) return 0;
    return dx < 0 ? 1 : -1;
}

/** What one hour's bar in the week strip represents. */
export type HourBarKind = 'free' | 'edge';

/**
 * One bar per visible hour for a day's strip column.
 *
 * Two states only: the viewer is free, or they are not. ROK-1569 had a third,
 * hatched "stale" kind for the unclaimed hours of an old week; the operator
 * ruled the cross-hatch out on 2026-09-16 (ROK-1579) and the prompt above the
 * editor carries the staleness instead.
 */
export function hourBarKinds(
    slots: GameTimeSlot[], dayOfWeek: number, hours: number[],
): HourBarKind[] {
    const active = new Set(
        slots.filter((s) => s.dayOfWeek === dayOfWeek && isSlotActive(s)).map((s) => s.hour),
    );
    return hours.map((h) => (active.has(h) ? 'free' : 'edge'));
}
