/**
 * Pure helpers behind the phone week editor (ROK-1569).
 *
 * These carry the two rules that are easy to get silently wrong — the day
 * clamp (Sun..Sat, no wrap) and the swipe threshold — so they are unit-tested
 * away from the DOM.
 */
import { describe, it, expect } from 'vitest';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { clampDay, dayFreeLabel, dayStripLabel, freeHourCount, hourBarKinds, swipeStep } from '../phone-week.utils';

const HOURS = [17, 18, 19, 20, 21, 22, 23];
const avail = (day: number, hours: number[]): GameTimeSlot[] =>
    hours.map((h) => ({ dayOfWeek: day, hour: h, status: 'available' as const }));

describe('freeHourCount', () => {
    it('counts the active hours of one day inside the visible range', () => {
        const slots = [...avail(2, [19, 20, 21]), ...avail(3, [19])];
        expect(freeHourCount(slots, 2, HOURS)).toBe(3);
    });

    it('ignores hours outside the visible range and non-available statuses', () => {
        const slots: GameTimeSlot[] = [
            ...avail(2, [19]),
            { dayOfWeek: 2, hour: 3, status: 'available' },
            { dayOfWeek: 2, hour: 20, status: 'blocked' },
        ];
        expect(freeHourCount(slots, 2, HOURS)).toBe(1);
    });
});

describe('labels', () => {
    it('says "nothing yet" for a day with no free hours', () => {
        expect(dayFreeLabel(0)).toBe('nothing yet');
    });

    it('summarises a day in hours', () => {
        expect(dayFreeLabel(3)).toBe('3h free');
    });

    it('spells the strip label out for screen readers', () => {
        expect(dayStripLabel(2, 4)).toBe('Tuesday, 4 hours free');
        expect(dayStripLabel(0, 1)).toBe('Sunday, 1 hour free');
        expect(dayStripLabel(6, 0)).toBe('Saturday, no hours free');
    });
});

describe('clampDay', () => {
    it('keeps a day inside Sunday..Saturday instead of wrapping', () => {
        expect(clampDay(-1)).toBe(0);
        expect(clampDay(7)).toBe(6);
        expect(clampDay(3)).toBe(3);
    });
});

describe('swipeStep', () => {
    it('steps forward on a decisive leftward drag', () => {
        expect(swipeStep(-90, 10)).toBe(1);
    });

    it('steps back on a decisive rightward drag', () => {
        expect(swipeStep(90, 10)).toBe(-1);
    });

    it('ignores a drag that never clears the distance threshold', () => {
        expect(swipeStep(-60, 0)).toBe(0);
    });

    it('ignores a drag that is mostly vertical — that gesture is a page scroll', () => {
        expect(swipeStep(-90, 70)).toBe(0);
    });
});

describe('hourBarKinds', () => {
    it('marks the free hours and leaves the rest as edges when the week is fresh', () => {
        expect(hourBarKinds(avail(2, [19, 20]), 2, HOURS, false))
            .toEqual(['edge', 'edge', 'free', 'free', 'edge', 'edge', 'edge']);
    });

    it('hatches the unclaimed hours only when the caller says the week is stale', () => {
        expect(hourBarKinds(avail(2, [19]), 2, HOURS, true))
            .toEqual(['stale', 'stale', 'free', 'stale', 'stale', 'stale', 'stale']);
    });
});
