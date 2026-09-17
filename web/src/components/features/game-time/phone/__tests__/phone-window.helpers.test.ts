/**
 * ROK-1584 — the profile drawer's hour window opens BOTH ways.
 *
 * ROK-1579 gave the drawer a window that ends at 1 AM with "Show earlier" for
 * the morning. The approved second pass (§3 of
 * `planning-artifacts/design-poll-hero-second-pass-2026-09-16.html`) makes the
 * profile reach all 24 hours: the default view is still the evening
 * (6 PM – 1 AM, fitted), "▴ Show earlier (6 AM – 6 PM)" adds the day above it
 * and "▾ Show later (1 AM – 6 AM)" adds the small hours below it. Each band
 * auto-opens when the saved week has hours in it and is remembered on its own.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PROFILE_HOURS } from '../phone-week-check.helpers';
import {
    EARLIER_HOURS, LATER_HOURS, PROFILE_WINDOW_KEY, desktopHourRange,
    hasClaimedHourIn, hasHourOutsideWindow, profileWindowHours,
    readProfileWindow, splitHourRange, writeProfileWindow,
} from '../phone-window.helpers';

const COLLAPSED = { earlier: false, later: false };

describe('splitHourRange — the three bands of the profile day', () => {
    it('splits the profile range into 6 AM–6 PM, the evening, and 1 AM–6 AM', () => {
        const { earlier, base, later } = splitHourRange(PROFILE_HOURS);
        expect(earlier).toEqual(EARLIER_HOURS);
        expect(base).toEqual([18, 19, 20, 21, 22, 23, 0]);
        expect(later).toEqual(LATER_HOURS);
    });

    it('leaves a range with no band hours alone (the check\'s seven evening hours)', () => {
        const { earlier, base, later } = splitHourRange([17, 18, 19, 20, 21, 22, 23]);
        expect(earlier).toEqual([17]);
        expect(base).toEqual([18, 19, 20, 21, 22, 23]);
        expect(later).toEqual([]);
    });
});

describe('profileWindowHours — as many 44px rows as fit, taken from the end', () => {
    it('keeps the LAST rows that fit, so the window still ends at 1 AM', () => {
        // 10 rows fit in 460px (10 × 44 = 440, 11 would need 484).
        const { hours, hiddenEarlier } = profileWindowHours(PROFILE_HOURS, 460, COLLAPSED);
        expect(hours).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 0]);
        expect(hiddenEarlier).toBe(9);
    });

    it('never drops below eight rows, however short the slot is', () => {
        const { hours } = profileWindowHours(PROFILE_HOURS, 0, COLLAPSED);
        expect(hours).toEqual([17, 18, 19, 20, 21, 22, 23, 0]);
    });

    it('adds the morning above when the earlier band is open', () => {
        const { hours } = profileWindowHours(PROFILE_HOURS, 460, { earlier: true, later: false });
        expect(hours[0]).toBe(6);
        expect(hours[hours.length - 1]).toBe(0);
        expect(hours).toHaveLength(19);
    });

    it('adds the small hours below when the later band is open, and reports what it hides', () => {
        const { hours, hiddenLater } = profileWindowHours(PROFILE_HOURS, 460, { earlier: false, later: true });
        expect(hours.slice(-6)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(hiddenLater).toBe(5);
    });

    it('shows all 24 hours when both bands are open', () => {
        const { hours } = profileWindowHours(PROFILE_HOURS, 460, { earlier: true, later: true });
        expect(hours).toEqual(PROFILE_HOURS);
    });

    it('leaves a short range alone and offers no band it cannot fill', () => {
        const { hours, hiddenEarlier, hiddenLater } = profileWindowHours(
            [17, 18, 19, 20, 21, 22, 23], 300, COLLAPSED,
        );
        expect(hours).toEqual([17, 18, 19, 20, 21, 22, 23]);
        expect(hiddenEarlier).toBe(0);
        expect(hiddenLater).toBe(0);
    });
});

describe('hasHourOutsideWindow — the shift worker opens expanded', () => {
    const window8 = [17, 18, 19, 20, 21, 22, 23, 0];
    const head = [...EARLIER_HOURS, 18, 19, 20, 21, 22, 23, 0];

    it('is true when a saved hour sits before the window start, on any day', () => {
        expect(hasHourOutsideWindow(
            [{ dayOfWeek: 3, hour: 10, status: 'available' }], window8, head,
        )).toBe(true);
    });

    it('ignores a saved hour the band could not reveal either (no permanent latch)', () => {
        expect(hasHourOutsideWindow(
            [{ dayOfWeek: 3, hour: 3, status: 'available' }], window8, head,
        )).toBe(false);
    });

    it('is false when every saved hour is inside the window', () => {
        expect(hasHourOutsideWindow(
            [{ dayOfWeek: 2, hour: 19, status: 'available' }, { dayOfWeek: 2, hour: 0, status: 'available' }],
            window8, head,
        )).toBe(false);
    });

    it('ignores hours that are not actually claimed', () => {
        expect(hasHourOutsideWindow(
            [{ dayOfWeek: 2, hour: 10, status: 'unavailable' }], window8, head,
        )).toBe(false);
    });
});

describe('hasClaimedHourIn — the night owl opens the later band', () => {
    it('is true when a claimed hour sits in the band', () => {
        expect(hasClaimedHourIn([{ dayOfWeek: 6, hour: 3, status: 'available' }], LATER_HOURS)).toBe(true);
    });

    it('is false for an unclaimed hour, or one outside the band', () => {
        expect(hasClaimedHourIn([{ dayOfWeek: 6, hour: 3, status: 'unavailable' }], LATER_HOURS)).toBe(false);
        expect(hasClaimedHourIn([{ dayOfWeek: 6, hour: 20, status: 'available' }], LATER_HOURS)).toBe(false);
    });
});

describe('the remembered window', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips both bands through localStorage under the documented key', () => {
        writeProfileWindow({ earlier: true });
        expect(readProfileWindow()).toEqual({ earlier: true, later: null });

        writeProfileWindow({ later: false });
        expect(JSON.parse(localStorage.getItem(PROFILE_WINDOW_KEY) ?? '{}')).toEqual({ earlier: true, later: false });
        expect(readProfileWindow()).toEqual({ earlier: true, later: false });
    });

    it('reads null per band when nothing was ever chosen, so auto-expand decides', () => {
        expect(readProfileWindow()).toEqual({ earlier: null, later: null });
    });

    it('migrates the ROK-1579 string form, leaving the new band unchosen', () => {
        localStorage.setItem(PROFILE_WINDOW_KEY, 'full');
        expect(readProfileWindow()).toEqual({ earlier: true, later: null });
        localStorage.setItem(PROFILE_WINDOW_KEY, 'fit');
        expect(readProfileWindow()).toEqual({ earlier: false, later: null });
    });

    it('treats a junk value as no choice rather than throwing', () => {
        localStorage.setItem(PROFILE_WINDOW_KEY, 'wat');
        expect(readProfileWindow()).toEqual({ earlier: null, later: null });
        localStorage.setItem(PROFILE_WINDOW_KEY, '{"earlier":"yes"}');
        expect(readProfileWindow()).toEqual({ earlier: null, later: null });
    });
});

describe('desktopHourRange (ROK-1585 AC4a)', () => {
    it('shows 6 PM – 1 AM when both bands are closed', () => {
        expect(desktopHourRange({ earlier: false, later: false })).toEqual([18, 1]);
    });

    it('starts at 6 AM when the earlier band is open', () => {
        expect(desktopHourRange({ earlier: true, later: false })).toEqual([6, 1]);
    });

    it('runs to 6 AM when the later band is open', () => {
        expect(desktopHourRange({ earlier: false, later: true })).toEqual([18, 6]);
    });

    it('covers all 24 hours from 6 AM when both are open', () => {
        expect(desktopHourRange({ earlier: true, later: true })).toEqual([6, 6]);
    });
});
