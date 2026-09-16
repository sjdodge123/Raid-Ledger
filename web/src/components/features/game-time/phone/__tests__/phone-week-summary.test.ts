/**
 * The profile card's one-line reading of the saved week (ROK-1579).
 *
 * The phone profile no longer paints the editor inline — it shows what is
 * saved and opens the editor in the drawer. These are the wordings that card
 * has to produce.
 */
import { describe, it, expect } from 'vitest';
import type { GameTimeAbsence, GameTimeSlot } from '@raid-ledger/contract';
import { summariseAbsences, summariseWeek } from '../phone-week-summary';

/** Active template hours for a set of days. */
function week(days: number[], hours: number[]): GameTimeSlot[] {
    return days.flatMap((dayOfWeek) => hours.map((hour) => ({ dayOfWeek, hour, status: 'available' as const })));
}

describe('summariseWeek', () => {
    it('collapses contiguous days into a range', () => {
        expect(summariseWeek(week([1, 2, 3, 4, 5], [19, 20, 21]))).toBe('Mon–Fri 7–10 PM');
    });

    it('lists non-contiguous days', () => {
        expect(summariseWeek(week([2, 4], [20, 21, 22, 23]))).toBe('Tue, Thu 8 PM–12 AM');
    });

    it('keeps a two-day run a list, not a range', () => {
        expect(summariseWeek(week([0, 6], [13, 14]))).toBe('Sun, Sat 1–3 PM');
    });

    it('carries a late-night run past midnight', () => {
        expect(summariseWeek(week([5], [23, 0]))).toBe('Fri 11 PM–1 AM');
    });

    it('splits days that keep different hours', () => {
        const slots = [...week([1, 2, 3, 4, 5], [19, 20, 21]), ...week([6], [14, 15, 16, 17])];
        expect(summariseWeek(slots)).toBe('Mon–Fri 7–10 PM; Sat 2–6 PM');
    });

    it('lists the gaps inside one day', () => {
        expect(summariseWeek(week([3], [10, 11, 20, 21]))).toBe('Wed 10 AM–12 PM, 8–10 PM');
    });

    it('says so when nothing is saved', () => {
        expect(summariseWeek([])).toBe('No game time yet');
    });

    it('ignores slots that are not the viewer\'s own available hours', () => {
        const committed: GameTimeSlot[] = [{ dayOfWeek: 1, hour: 20, status: 'committed' }];
        expect(summariseWeek(committed)).toBe('No game time yet');
    });
});

/** Absences come back from the API as inclusive ISO date ranges. */
function absence(id: number, startDate: string, endDate: string): GameTimeAbsence {
    return { id, startDate, endDate, reason: null };
}

describe('summariseAbsences', () => {
    it('is nothing at all when the viewer has no absences', () => {
        expect(summariseAbsences([])).toBeNull();
    });

    it('words a range inside one month', () => {
        expect(summariseAbsences([absence(1, '2026-09-17', '2026-09-19')])).toBe('Away Sep 17–19');
    });

    it('words a single day', () => {
        expect(summariseAbsences([absence(1, '2026-09-17', '2026-09-17')])).toBe('Away Sep 17');
    });

    it('words a range that crosses a month', () => {
        expect(summariseAbsences([absence(1, '2026-09-30', '2026-10-02')])).toBe('Away Sep 30–Oct 2');
    });

    it('leads with the earliest and counts the rest', () => {
        const all = [absence(2, '2026-10-05', '2026-10-06'), absence(1, '2026-09-17', '2026-09-19')];
        expect(summariseAbsences(all)).toBe('Away Sep 17–19 +1 more');
    });
});
