import { describe, it, expect } from 'vitest';
import {
    activePick,
    awayRangeLabel,
    awayRowMeta,
    calendarRowMeta,
    newestReadSync,
    nextAwayLabel,
    rowMeta,
    upcomingAbsences,
} from '../away-panel.helpers';
import { toAwayRows } from '../away-row.types';
import type { CalendarsOverview } from '@raid-ledger/contract';
import { at } from '../../../../../test/defined';

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

describe('toAwayRows (ROK-1595 D4)', () => {
    it('maps a manual absence to a manual row with a stable key', () => {
        expect(toAwayRows([abs(7, '2026-09-19', '2026-09-20', 'Lake trip')])).toEqual([
            { key: 'manual-7', id: 7, startDate: '2026-09-19', endDate: '2026-09-20',
                reason: 'Lake trip', source: 'manual', provider: null },
        ]);
    });

    // Regression: `toManualRows` forced every row to manual, so a synced day
    // offered Remove and the click got a 409 `use_ignore`.
    it('keeps a synced absence a calendar row, with its provider', () => {
        const row = at(toAwayRows([{ ...abs(12, '2026-10-24', '2026-10-27'), source: 'calendar', provider: 'google' }]), 0);
        expect(row.source).toBe('calendar');
        expect(row.provider).toBe('google');
        expect(row.key).toBe('calendar-12');
    });

    it('treats a payload without source as manual and drops a stray provider', () => {
        expect(at(toAwayRows([abs(1, '2026-09-19', '2026-09-19')]), 0).source).toBe('manual');
        expect(at(toAwayRows([{ ...abs(2, '2026-09-19', '2026-09-19'), source: 'manual', provider: 'google' }]), 0).provider).toBeNull();
    });

    it('normalises a missing reason to null', () => {
        expect(at(toAwayRows([{ id: 1, startDate: '2026-09-19', endDate: '2026-09-19' }]), 0).reason)
            .toBeNull();
    });
});

describe('synced row meta (ROK-1595 S1)', () => {
    it('reads "{n} days · Google Calendar", or "All day · …" for one day', () => {
        expect(calendarRowMeta('2026-10-01', '2026-10-04', 'google')).toBe('4 days · Google Calendar');
        expect(calendarRowMeta('2026-10-16', '2026-10-16', 'google')).toBe('All day · Google Calendar');
        expect(calendarRowMeta('2026-10-16', '2026-10-16', null)).toBe('All day · Your calendar');
    });

    it('rowMeta picks by source: a manual one-day row still reads "1 day · note"', () => {
        const base = { key: 'k', id: 1, startDate: '2026-10-16', endDate: '2026-10-16', reason: 'Dentist' };
        expect(rowMeta({ ...base, source: 'manual', provider: null })).toBe('1 day · Dentist');
        expect(rowMeta({ ...base, source: 'calendar', provider: 'microsoft' })).toBe('All day · Outlook Calendar');
    });
});

describe('nextAwayLabel — from calendar (ROK-1595 S2)', () => {
    it('says "· from calendar" when the first upcoming day is synced', () => {
        const cal = { ...abs(2, '2026-10-01', '2026-10-04'), source: 'calendar' as const };
        expect(nextAwayLabel([cal, abs(3, '2026-10-16', '2026-10-16')], THURSDAY))
            .toBe('Thu Oct 1 – Sun Oct 4 · from calendar · +1 more');
        expect(nextAwayLabel([cal], THURSDAY)).toBe('Thu Oct 1 – Sun Oct 4 · from calendar');
        expect(nextAwayLabel([abs(3, '2026-09-19', '2026-09-20'), cal], THURSDAY)).toBe('Sat Sep 19 – Sun Sep 20 · +1 more');
    });
});

describe('newestReadSync (ROK-1595 S1 divider; wording pinned in lib/synced-ago.test.ts)', () => {
    const overview = (connections: CalendarsOverview['connections'], enabled = true): CalendarsOverview => ({
        enabled, providers: { google: { available: true }, microsoft: { available: false }, apple: { available: false } },
        connections, readSettings: { mode: 'both', lookAheadWeeks: 4 }, feed: null,
    });
    const conn = (id: number, lastSyncedAt: string | null, read = true): CalendarsOverview['connections'][number] => ({
        id, provider: 'google', accountLabel: null, status: 'active', lastSyncedAt, errorCode: null,
        read: { enabled: read, calendarIds: [] }, write: { enabled: false, target: 'dedicated' },
    });

    it('takes the newest sync among READING connections; null when off or never synced', () => {
        const list = [conn(1, '2026-10-12T08:00:00.000Z'), conn(2, '2026-10-12T09:00:00.000Z'), conn(3, '2026-10-12T09:04:00.000Z', false)];
        expect(newestReadSync(overview(list))).toBe('2026-10-12T09:00:00.000Z');
        expect(newestReadSync(overview(list, false))).toBeNull();
        expect(newestReadSync(overview([conn(1, null)]))).toBeNull();
        expect(newestReadSync(undefined)).toBeNull();
    });
});
