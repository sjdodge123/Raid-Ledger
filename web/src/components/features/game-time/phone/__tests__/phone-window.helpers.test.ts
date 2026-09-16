/**
 * ROK-1579 — the profile drawer's evening window (approved frame 3).
 *
 * The profile edits 17 hours (9 AM–1 AM) and only ~10 of them fit a phone at
 * the 44px touch row. Rather than squeezing the rows (ROK-1569's floor) or
 * opening on a scrolled-to-the-top morning nobody plays in, the drawer shows
 * as many rows as FIT, taken from the END of the range — so the window always
 * ends at the same late hour and the evening is on screen without a scroll.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PROFILE_HOURS } from '../phone-week-check.helpers';
import {
    PROFILE_WINDOW_KEY, fittedWindow, hasHourOutsideWindow,
    readProfileWindow, writeProfileWindow,
} from '../phone-window.helpers';

describe('fittedWindow — as many 44px rows as fit, taken from the end', () => {
    it('keeps the LAST rows that fit, so the window still ends at 1 AM', () => {
        // 10 rows fit in 460px (10 × 44 = 440, 11 would need 484).
        const { hours, hiddenEarlier } = fittedWindow(PROFILE_HOURS, 460, false);
        expect(hours).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 0, 1]);
        expect(hiddenEarlier).toBe(7);
    });

    it('never drops below eight rows, however short the slot is', () => {
        const { hours } = fittedWindow(PROFILE_HOURS, 0, false);
        expect(hours).toEqual([18, 19, 20, 21, 22, 23, 0, 1]);
    });

    it('shows the whole range when every hour fits, and reports nothing hidden', () => {
        const { hours, hiddenEarlier } = fittedWindow(PROFILE_HOURS, 17 * 44, false);
        expect(hours).toEqual(PROFILE_HOURS);
        expect(hiddenEarlier).toBe(0);
    });

    it('shows the whole range when expanded, while still reporting what the fit would hide', () => {
        const { hours, hiddenEarlier } = fittedWindow(PROFILE_HOURS, 460, true);
        expect(hours).toEqual(PROFILE_HOURS);
        expect(hiddenEarlier).toBe(7);
    });

    it('leaves a short range (the check\'s seven evening hours) alone', () => {
        const { hours, hiddenEarlier } = fittedWindow([17, 18, 19, 20, 21, 22, 23], 300, false);
        expect(hours).toEqual([17, 18, 19, 20, 21, 22, 23]);
        expect(hiddenEarlier).toBe(0);
    });
});

describe('hasHourOutsideWindow — the shift worker opens expanded', () => {
    const window8 = [18, 19, 20, 21, 22, 23, 0, 1];

    it('is true when a saved hour sits before the window start, on any day', () => {
        expect(hasHourOutsideWindow(
            [{ dayOfWeek: 3, hour: 10, status: 'available' }], window8, PROFILE_HOURS,
        )).toBe(true);
    });

    it('ignores a saved hour the FULL range would not show either (review MINOR 2: no permanent latch)', () => {
        // 7 AM is editable through the refresh modal's wider range but is outside
        // PROFILE_HOURS, so expanding could never satisfy it — it must not count.
        expect(hasHourOutsideWindow(
            [{ dayOfWeek: 3, hour: 7, status: 'available' }], window8, PROFILE_HOURS,
        )).toBe(false);
    });

    it('is false when every saved hour is inside the window', () => {
        expect(hasHourOutsideWindow(
            [{ dayOfWeek: 2, hour: 19, status: 'available' }, { dayOfWeek: 2, hour: 1, status: 'available' }],
            window8, PROFILE_HOURS,
        )).toBe(false);
    });

    it('ignores hours that are not actually claimed', () => {
        expect(hasHourOutsideWindow(
            [{ dayOfWeek: 2, hour: 10, status: 'unavailable' }], window8, PROFILE_HOURS,
        )).toBe(false);
    });
});

describe('the remembered window', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips through localStorage under the documented key', () => {
        writeProfileWindow(true);
        expect(localStorage.getItem(PROFILE_WINDOW_KEY)).toBe('full');
        expect(readProfileWindow()).toBe(true);
        writeProfileWindow(false);
        expect(localStorage.getItem(PROFILE_WINDOW_KEY)).toBe('fit');
        expect(readProfileWindow()).toBe(false);
    });

    it('reads null when nothing was ever chosen, so auto-expand decides', () => {
        expect(readProfileWindow()).toBeNull();
    });

    it('treats a junk value as no choice rather than throwing', () => {
        localStorage.setItem(PROFILE_WINDOW_KEY, 'wat');
        expect(readProfileWindow()).toBeNull();
    });
});
