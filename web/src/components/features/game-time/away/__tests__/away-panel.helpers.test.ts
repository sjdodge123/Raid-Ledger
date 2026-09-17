import { describe, it, expect } from 'vitest';
import {
    activePick,
    awayRangeLabel,
    awayRowMeta,
    nextAwayLabel,
    upcomingAbsences,
} from '../away-panel.helpers';
import { toManualRows } from '../away-row.types';

/** Frozen Thursday, local time — the presets and "upcoming" are relative to it. */
const THURSDAY = new Date(2026, 7, 27, 12, 0, 0); // 2026-08-27

const abs = (id: number, startDate: string, endDate: string, reason: string | null = null) =>
    ({ id, startDate, endDate, reason });

describe('awayRangeLabel', () => {
    it('formats a range with short weekday, month and day', () => {
        expect(awayRangeLabel('2026-09-21', '2026-09-27')).toBe('Mon Sep 21 – Sun Sep 27');
    });

    it('crosses a year boundary in local time', () => {
        expect(awayRangeLabel('2026-12-30', '2027-01-02')).toBe('Wed Dec 30 – Sat Jan 2');
    });

    it('collapses a single day to one date', () => {
        expect(awayRangeLabel('2026-09-19', '2026-09-19')).toBe('Sat Sep 19');
    });
});

describe('awayRowMeta', () => {
    it('is the inclusive day count alone without a reason', () => {
        expect(awayRowMeta('2026-09-21', '2026-09-27', null)).toBe('7 days');
    });

    it('appends the reason after a middot', () => {
        expect(awayRowMeta('2026-09-19', '2026-09-20', 'Lake trip')).toBe('2 days · Lake trip');
    });

    it('ignores a blank reason', () => {
        expect(awayRowMeta('2026-09-19', '2026-09-19', '  ')).toBe('1 day');
    });
});

describe('upcomingAbsences', () => {
    it('hides ended absences, keeps one ending today, sorts by start across months', () => {
        const list = [
            abs(1, '2026-10-01', '2026-10-04'),
            abs(2, '2026-08-20', '2026-08-26'),
            abs(3, '2026-08-25', '2026-08-27'),
            abs(4, '2026-12-30', '2027-01-02'),
            abs(5, '2026-09-19', '2026-09-20'),
        ];
        expect(upcomingAbsences(list, THURSDAY).map((a) => a.id)).toEqual([3, 5, 1, 4]);
    });

    it('does not mutate its input', () => {
        const list = [abs(1, '2026-10-01', '2026-10-04'), abs(2, '2026-09-01', '2026-09-02')];
        upcomingAbsences(list, THURSDAY);
        expect(list.map((a) => a.id)).toEqual([1, 2]);
    });
});

describe('nextAwayLabel', () => {
    it('is null with nothing upcoming', () => {
        expect(nextAwayLabel([], THURSDAY)).toBeNull();
        expect(nextAwayLabel([abs(1, '2026-08-01', '2026-08-02')], THURSDAY)).toBeNull();
    });

    it('names the next range alone when it is the only one', () => {
        expect(nextAwayLabel([abs(1, '2026-09-19', '2026-09-20')], THURSDAY))
            .toBe('Sat Sep 19 – Sun Sep 20');
    });

    it('adds "+N more" for the rest', () => {
        const list = [abs(1, '2026-10-01', '2026-10-04'), abs(2, '2026-09-19', '2026-09-20'),
            abs(3, '2026-11-01', '2026-11-01')];
        expect(nextAwayLabel(list, THURSDAY)).toBe('Sat Sep 19 – Sun Sep 20 · +2 more');
    });
});

describe('activePick', () => {
    it('is null for an empty form', () => {
        expect(activePick('', '', THURSDAY)).toBeNull();
    });

    it('matches the weekend and next-week presets', () => {
        expect(activePick('2026-08-29', '2026-08-30', THURSDAY)).toBe('weekend');
        expect(activePick('2026-08-31', '2026-09-06', THURSDAY)).toBe('next-week');
    });

    it('is custom for anything else, including a half-filled range', () => {
        expect(activePick('2026-08-29', '2026-09-02', THURSDAY)).toBe('custom');
        expect(activePick('2026-08-29', '', THURSDAY)).toBe('custom');
    });
});

describe('toManualRows', () => {
    it('maps absences to manual rows with a stable key', () => {
        expect(toManualRows([abs(7, '2026-09-19', '2026-09-20', 'Lake trip')])).toEqual([
            { key: 'manual-7', id: 7, startDate: '2026-09-19', endDate: '2026-09-20',
                reason: 'Lake trip', source: 'manual' },
        ]);
    });

    it('normalises a missing reason to null', () => {
        expect(toManualRows([{ id: 1, startDate: '2026-09-19', endDate: '2026-09-19' }])[0].reason)
            .toBeNull();
    });
});
