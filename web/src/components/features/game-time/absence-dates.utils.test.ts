import { describe, it, expect } from 'vitest';
import { toISODate, quickRange, spanDays, spanLabel } from './absence-dates.utils';

/** Local-time construction, matching how the helpers read dates. */
const at = (y: number, m: number, d: number): Date => new Date(y, m - 1, d);

describe('toISODate', () => {
    it('zero-pads month and day', () => {
        expect(toISODate(at(2026, 3, 7))).toBe('2026-03-07');
    });

    it('uses local getters, so a late-evening date does not roll forward', () => {
        // 23:30 local would already be the next day in UTC for anyone west of GMT.
        expect(toISODate(new Date(2026, 7, 27, 23, 30))).toBe('2026-08-27');
    });
});

describe('quickRange — this weekend', () => {
    it('picks the coming Saturday and Sunday from midweek', () => {
        // 2026-08-27 is a Thursday.
        expect(quickRange('weekend', at(2026, 8, 27)))
            .toEqual({ startDate: '2026-08-29', endDate: '2026-08-30' });
    });

    it('stays on today when today is already Saturday', () => {
        expect(quickRange('weekend', at(2026, 8, 29)))
            .toEqual({ startDate: '2026-08-29', endDate: '2026-08-30' });
    });

    it('jumps to the next Saturday when today is Sunday', () => {
        expect(quickRange('weekend', at(2026, 8, 30)))
            .toEqual({ startDate: '2026-09-05', endDate: '2026-09-06' });
    });

    it('spans a month boundary without drifting', () => {
        // 2026-10-29 is a Thursday; the weekend lands in the next month.
        expect(quickRange('weekend', at(2026, 10, 29)))
            .toEqual({ startDate: '2026-10-31', endDate: '2026-11-01' });
    });
});

describe('quickRange — next week', () => {
    it('runs the next Monday through Sunday', () => {
        expect(quickRange('next-week', at(2026, 8, 27)))
            .toEqual({ startDate: '2026-08-31', endDate: '2026-09-06' });
    });

    it('means the FOLLOWING week when asked on a Monday', () => {
        expect(quickRange('next-week', at(2026, 8, 31)))
            .toEqual({ startDate: '2026-09-07', endDate: '2026-09-13' });
    });

    it('picks tomorrow when today is Sunday', () => {
        expect(quickRange('next-week', at(2026, 8, 30)))
            .toEqual({ startDate: '2026-08-31', endDate: '2026-09-06' });
    });

    it('always covers exactly seven days', () => {
        for (let day = 1; day <= 31; day++) {
            const { startDate, endDate } = quickRange('next-week', at(2026, 3, day));
            expect(spanDays(startDate, endDate)).toBe(7);
        }
    });
});

describe('spanDays', () => {
    it('counts both endpoints, so a weekend is two days', () => {
        expect(spanDays('2026-08-29', '2026-08-30')).toBe(2);
    });

    it('is 1 for a single day', () => {
        expect(spanDays('2026-08-29', '2026-08-29')).toBe(1);
    });

    it('is 0 for an inverted range', () => {
        expect(spanDays('2026-08-30', '2026-08-29')).toBe(0);
    });

    it('is 0 when either end is missing', () => {
        expect(spanDays('', '2026-08-29')).toBe(0);
        expect(spanDays('2026-08-29', '')).toBe(0);
    });

    it('is 0 for an unparseable date', () => {
        expect(spanDays('not-a-date', '2026-08-29')).toBe(0);
    });

    it('crosses a DST boundary without losing or gaining a day', () => {
        // US DST starts 2026-03-08; a naive ms/86400000 would give 30.958 -> 30.
        expect(spanDays('2026-03-01', '2026-03-31')).toBe(31);
    });

    it('handles a leap day', () => {
        expect(spanDays('2028-02-28', '2028-03-01')).toBe(3);
    });
});

describe('spanLabel', () => {
    it('singularises one day', () => {
        expect(spanLabel('2026-08-29', '2026-08-29')).toBe('1 day');
    });

    it('pluralises everything else', () => {
        expect(spanLabel('2026-08-29', '2026-08-30')).toBe('2 days');
    });

    it('is empty when there is nothing to count', () => {
        expect(spanLabel('', '')).toBe('');
    });
});
