/** Away days for the week strip and the desktop day headers (ROK-1585). */
import { describe, it, expect } from 'vitest';
import type { GameTimeAbsence } from '@raid-ledger/contract';
import { awayDatesInWeek, awayDaysOfWeek, awaySourceOf, awaySourcesOfWeek } from '../away-days';

const away = (startDate: string, endDate: string): GameTimeAbsence => ({
    id: 1, startDate, endDate, reason: null,
});

const sorted = (set: Set<number>): number[] => [...set].sort((a, b) => a - b);

describe('awayDaysOfWeek — the next seven days starting today', () => {
    it('is empty when nothing is booked', () => {
        expect(sorted(awayDaysOfWeek([], new Date(2026, 8, 16)))).toEqual([]);
    });

    it('marks the strip days a range covers, both ends inclusive', () => {
        // Wednesday 2026-09-16; away Sat 19 – Sun 20.
        const today = new Date(2026, 8, 16, 21, 30);
        expect(sorted(awayDaysOfWeek([away('2026-09-19', '2026-09-20')], today))).toEqual([0, 6]);
    });

    it('maps days before today in the week to NEXT week\'s date (Saturday → Sunday wrap)', () => {
        // Saturday 2026-09-19: strip Sunday is Sep 20, strip Friday is Sep 25.
        const today = new Date(2026, 8, 19);
        expect(sorted(awayDaysOfWeek([away('2026-09-20', '2026-09-20')], today))).toEqual([0]);
        expect(sorted(awayDaysOfWeek([away('2026-09-13', '2026-09-13')], today))).toEqual([]);
        expect(sorted(awayDaysOfWeek([away('2026-09-25', '2026-09-26')], today))).toEqual([5]);
    });

    it('crosses a month end', () => {
        // Tuesday 2026-09-29; away Wed Sep 30 – Fri Oct 2, and Mon Oct 5 is today + 6.
        const today = new Date(2026, 8, 29);
        const absences = [away('2026-09-30', '2026-10-02'), away('2026-10-05', '2026-10-09')];
        expect(sorted(awayDaysOfWeek(absences, today))).toEqual([1, 3, 4, 5]);
    });

    it('counts today itself when a range ends today', () => {
        const today = new Date(2026, 8, 16);
        expect(sorted(awayDaysOfWeek([away('2026-09-10', '2026-09-16')], today))).toEqual([3]);
    });
});

describe('awayDatesInWeek — the Sun–Sat week starting weekStart', () => {
    it('marks the days of the displayed week a range covers, inclusively', () => {
        const weekStart = new Date(2026, 8, 13); // Sunday
        const absences = [away('2026-09-11', '2026-09-14'), away('2026-09-19', '2026-09-25')];
        expect(sorted(awayDatesInWeek(absences, weekStart))).toEqual([0, 1, 6]);
    });

    it('crosses a month end', () => {
        const weekStart = new Date(2026, 8, 27); // Sunday Sep 27 – Saturday Oct 3
        expect(sorted(awayDatesInWeek([away('2026-10-01', '2026-10-01')], weekStart))).toEqual([4]);
    });

    it('ignores ranges outside the week', () => {
        const weekStart = new Date(2026, 8, 13);
        expect(sorted(awayDatesInWeek([away('2026-09-20', '2026-09-30')], weekStart))).toEqual([]);
    });
});

describe('awaySourcesOfWeek / awaySourceOf (ROK-1595 S2)', () => {
    const today = new Date(2026, 8, 16); // Wed Sep 16 2026
    const synced = (startDate: string, endDate: string): GameTimeAbsence =>
        ({ ...away(startDate, endDate), id: 2, source: 'calendar', provider: 'google' });

    it('marks a synced-only day calendar and a manual day manual', () => {
        const days = awaySourcesOfWeek([away('2026-09-19', '2026-09-19'), synced('2026-09-17', '2026-09-17')], today);
        expect([...days.entries()].sort()).toEqual([[4, 'calendar'], [6, 'manual']]);
    });

    it('lets manual win where both cover the day, and reads a missing source as manual', () => {
        const both = awaySourcesOfWeek([synced('2026-09-18', '2026-09-18'), away('2026-09-18', '2026-09-18')], today);
        expect(both.get(5)).toBe('manual');
        expect(awaySourcesOfWeek([away('2026-09-17', '2026-09-17')], today).get(4)).toBe('manual');
    });

    it('agrees with awayDaysOfWeek on WHICH days are away', () => {
        const list = [away('2026-09-19', '2026-09-20'), synced('2026-09-16', '2026-09-17')];
        expect(sorted(new Set(awaySourcesOfWeek(list, today).keys()))).toEqual(sorted(awayDaysOfWeek(list, today)));
    });

    it('awaySourceOf reads a map, a plain set (manual) and nothing', () => {
        expect(awaySourceOf(new Map([[3, 'calendar' as const]]), 3)).toBe('calendar');
        expect(awaySourceOf(new Set([3]), 3)).toBe('manual');
        expect(awaySourceOf(new Set([3]), 4)).toBeNull();
        expect(awaySourceOf(undefined, 3)).toBeNull();
    });
});
