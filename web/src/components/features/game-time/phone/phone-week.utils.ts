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

/** One band of the condensed week strip, in the app's 0..23 hour space. */
export interface StripBand {
    id: 'day' | 'evening' | 'late';
    /** The hours it covers. The late band wraps past midnight (…23, 0). */
    hours: number[];
}

/** Hours `from` (inclusive) to `to` (exclusive), wrapping past midnight. */
function hourRange(from: number, to: number): number[] {
    return Array.from({ length: to - from }, (_, i) => (from + i) % 24);
}

/**
 * The three bands the week strip summarises — day 9 AM–5 PM, evening 5–9 PM,
 * late 9 PM–1 AM (operator ruling 2026-09-16, ROK-1579: three bars per day,
 * never one per hour).
 *
 * They are FIXED — deliberately independent of whatever hours the editor is
 * showing. The strip's job is the whole day at a glance, so on the profile's
 * fitted window it still has to say that the viewer saved a daytime shift.
 *
 * A late-night hour belongs to the day it starts on socially: Tuesday 11 PM
 * and the midnight after it are both `dayOfWeek` 2, the same convention the
 * editor's wrapping visible-hours range already uses.
 */
export const STRIP_BANDS: readonly StripBand[] = [
    { id: 'day', hours: hourRange(9, 17) },
    { id: 'evening', hours: hourRange(17, 21) },
    { id: 'late', hours: hourRange(21, 25) },
];

/**
 * How much of each band the viewer has claimed on one day, 0..1, in
 * `STRIP_BANDS` order.
 */
export function bandShares(slots: GameTimeSlot[], dayOfWeek: number): [number, number, number] {
    const active = new Set(
        slots.filter((s) => s.dayOfWeek === dayOfWeek && isSlotActive(s)).map((s) => s.hour),
    );
    const share = (band: StripBand): number =>
        band.hours.filter((h) => active.has(h)).length / band.hours.length;
    return [share(STRIP_BANDS[0]), share(STRIP_BANDS[1]), share(STRIP_BANDS[2])];
}

/** What one band's bar in the week strip represents. */
export type BandKind = 'full' | 'partial' | 'none';

/**
 * A band's bar reads as filled, half-filled or empty.
 *
 * Three states only: ROK-1569 had a hatched "stale" kind for the unclaimed
 * hours of an old week; the operator ruled the cross-hatch out on 2026-09-16
 * (ROK-1579) and the prompt above the editor carries the staleness instead.
 */
export function bandKind(share: number): BandKind {
    if (share >= 0.999) return 'full';
    return share > 0 ? 'partial' : 'none';
}
