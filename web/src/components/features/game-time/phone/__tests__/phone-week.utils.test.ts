/**
 * Pure helpers behind the phone week editor (ROK-1569).
 *
 * These carry the two rules that are easy to get silently wrong — the day
 * clamp (Sun..Sat, no wrap) and the swipe threshold — so they are unit-tested
 * away from the DOM.
 */
import { describe, it, expect } from 'vitest';
import type { GameTimeSlot } from '@raid-ledger/contract';
import {
    bandKind, bandShares, clampDay, dayFreeLabel, dayStripLabel, freeHourCount, STRIP_BANDS, swipeStep,
} from '../phone-week.utils';

const HOURS = [17, 18, 19, 20, 21, 22, 23];
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
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

describe('STRIP_BANDS', () => {
    // ROK-1579 (operator ruling 2026-09-16): the strip is condensed to three
    // bands — day 9 AM–5 PM, evening 5–9 PM, late 9 PM–1 AM. They are FIXED:
    // the strip summarises the WHOLE day whatever hours the editor happens to
    // show, which is what makes it readable on the fitted profile window.
    it('covers 9 AM to 1 AM as day, evening and late', () => {
        expect(STRIP_BANDS.map((b) => b.id)).toEqual(['day', 'evening', 'late']);
        expect(STRIP_BANDS[0].hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
        expect(STRIP_BANDS[1].hours).toEqual([17, 18, 19, 20]);
    });

    it('wraps the late band past midnight', () => {
        expect(STRIP_BANDS[2].hours).toEqual([21, 22, 23, 0, 1]);
    });
});

describe('bandShares', () => {
    it('splits a 7–10 PM block across the evening and late bands', () => {
        expect(bandShares(avail(2, [19, 20, 21]), 2)).toEqual([0, 0.5, 0.2]);
    });

    it('fills every band for a whole claimed day', () => {
        expect(bandShares(avail(2, ALL_HOURS), 2)).toEqual([1, 1, 1]);
    });

    it('is empty for a day the viewer has claimed nothing on', () => {
        expect(bandShares(avail(3, [19, 20]), 2)).toEqual([0, 0, 0]);
    });

    it('counts the hour past midnight in the same day\'s late band', () => {
        // The app stores a late-night hour on the day it belongs to socially
        // (Tuesday 11 PM and Tuesday midnight are both dayOfWeek 2), the same
        // convention the wrapping visible-hours range uses.
        expect(bandShares(avail(2, [23, 0]), 2)).toEqual([0, 0, 0.4]);
    });

    it('ignores the hours outside 9 AM–1 AM and the non-available statuses', () => {
        const slots: GameTimeSlot[] = [
            ...avail(2, [3, 19, 20]),
            { dayOfWeek: 2, hour: 21, status: 'blocked' },
        ];
        expect(bandShares(slots, 2)).toEqual([0, 0.5, 0]);
    });
});

describe('bandKind', () => {
    it('is full only when the whole band is claimed', () => {
        expect(bandKind(1)).toBe('full');
    });

    it('is partial for any share of the band', () => {
        expect(bandKind(0.25)).toBe('partial');
        expect(bandKind(0.75)).toBe('partial');
    });

    it('is none for an untouched band', () => {
        expect(bandKind(0)).toBe('none');
    });
});
