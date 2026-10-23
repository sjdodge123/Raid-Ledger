/** ROK-1877 L1 — the weekly summary (Q6) and the muted start / stop / restart lines (Q4, Q8). */
import { describe, expect, it } from 'vitest';
import type { GameServerCalendarItemDto, GameServerEffect, GameServerMarkerItemDto, GameServerWindowItemDto } from '@raid-ledger/contract';
import { buildServerHours } from './server-hours.helpers';
import { powerLine, weekRows } from './server-hours-week.helpers';

const mine = { serverKey: '4', serverName: 'Valheim', gameId: 7, provider: 'pelican' };
const DAY = 86_400_000;
const NY = 'America/New_York';
const DEMO_SPANS = '9:00 AM – 9:40 AM, 2:00 PM – 10:00 PM';

const iso = (ms: number) => new Date(ms).toISOString();
const win = (start: string, end: string): GameServerWindowItemDto => ({ kind: 'window', ...mine, start, end, label: 'Up', source: 'schedule' });
const mark = (at: string, effect: GameServerEffect): GameServerMarkerItemDto => ({ kind: 'marker', ...mine, at, effect, label: effect });

/** `n` UTC days from `firstDay` ("2026-10-15"), each mapped to its items by `perDay(midnightMs)`. */
function everyDay<T>(firstDay: string, n: number, perDay: (midnight: number) => T[]): T[] {
    const base = Date.parse(`${firstDay}T00:00:00Z`);
    return Array.from({ length: n }, (_, i) => perDay(base + i * DAY)).flat();
}

/** The demo seed (`pelican-demo-seed-schedules.helpers.ts`): 13:00–13:40 and 18:00–02:00 UTC daily. */
const demoWindows = (firstDay: string, n: number) => everyDay(firstDay, n, (d) => [
    win(iso(d + 13 * 3_600_000), iso(d + 13 * 3_600_000 + 40 * 60_000)),
    win(iso(d + 18 * 3_600_000), iso(d + 26 * 3_600_000)),
]);
const daily = (firstDay: string, n: number, hourUtc: number, minuteUtc: number, effect: GameServerEffect) =>
    everyDay(firstDay, n, (d) => [mark(iso(d + hourUtc * 3_600_000 + minuteUtc * 60_000), effect)]);

const FRI_430PM_EDT = Date.parse('2026-10-16T20:30:00Z');
const MON_3PM_EDT_DST_WEEK = Date.parse('2026-10-26T19:00:00Z');

describe('weekRows (ROK-1877 Q6)', () => {
    it('collapses seven identical days to one "Every day" row, counting today\'s already-ended morning window', () => {
        expect(weekRows(demoWindows('2026-10-15', 9), FRI_430PM_EDT, NY)).toEqual([
            { key: '2026-10-16', label: 'Every day', spans: DEMO_SPANS },
        ]);
    });

    it('keeps the DST-shifted Sunday as its own row an hour earlier (US fall-back 2026-11-01)', () => {
        expect(weekRows(demoWindows('2026-10-25', 9), MON_3PM_EDT_DST_WEEK, NY)).toEqual([
            { key: '2026-10-26', label: 'Mon–Sat', spans: DEMO_SPANS },
            { key: '2026-11-01', label: 'Sun', spans: '8:00 AM – 8:40 AM, 1:00 PM – 9:00 PM' },
        ]);
    });

    it('merges a pair as "Fri, Sat" and a wrapped run as "Sun–Thu"; an overnight window stays one span on its start day', () => {
        const windows = [
            win('2026-10-16T18:00:00Z', '2026-10-17T02:00:00Z'),
            win('2026-10-17T18:00:00Z', '2026-10-18T02:00:00Z'),
            ...everyDay('2026-10-18', 5, (d) => [win(iso(d + 19 * 3_600_000), iso(d + 23 * 3_600_000))]),
        ];
        expect(weekRows(windows, Date.parse('2026-10-16T11:00:00Z'), 'UTC')).toEqual([
            { key: '2026-10-16', label: 'Fri, Sat', spans: '6:00 PM – 2:00 AM' },
            { key: '2026-10-18', label: 'Sun–Thu', spans: '7:00 PM – 11:00 PM' },
        ]);
    });

    it('merges only consecutive days ("Mon–Fri", then a separate "Sun") and ignores days outside this week', () => {
        const evening = (d: string) => win(`${d}T17:00:00Z`, `${d}T21:00:00Z`);
        const windows = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-25', '2026-10-26'].map(evening);
        expect(weekRows(windows, Date.parse('2026-10-19T08:00:00Z'), 'UTC')).toEqual([
            { key: '2026-10-19', label: 'Mon–Fri', spans: '5:00 PM – 9:00 PM' },
            { key: '2026-10-25', label: 'Sun', spans: '5:00 PM – 9:00 PM' },
        ]);
    });

    it('splits a 24h+ window per local day ("from" / "All day" / "until")', () => {
        expect(weekRows([win('2026-10-17T22:00:00Z', '2026-10-19T06:00:00Z')], Date.parse('2026-10-16T12:00:00Z'), 'UTC')).toEqual([
            { key: '2026-10-17', label: 'Sat', spans: 'from 10:00 PM' },
            { key: '2026-10-18', label: 'Sun', spans: 'All day' },
            { key: '2026-10-19', label: 'Mon', spans: 'until 6:00 AM' },
        ]);
    });

    it('is empty with no windows this week', () => {
        expect(weekRows([], FRI_430PM_EDT, NY)).toEqual([]);
    });
});

describe('powerLine (ROK-1877 Q4, Q8)', () => {
    it('says "nightly" for a restart every day, else the next one (the DST week has two on Sunday)', () => {
        expect(powerLine('restart', daily('2026-10-15', 9, 4, 5, 'restart'), FRI_430PM_EDT, NY)).toBe('Restart · nightly 12:05 AM');
        expect(powerLine('restart', daily('2026-10-25', 9, 4, 5, 'restart'), MON_3PM_EDT_DST_WEEK, NY)).toBe('Restart · Tue 12:05 AM');
    });

    it('shows a start-only schedule as "Starts · daily", or the next start when it is not every day', () => {
        expect(powerLine('start', daily('2026-10-15', 9, 22, 0, 'start'), FRI_430PM_EDT, NY)).toBe('Starts · daily 6:00 PM');
        expect(powerLine('start', [mark('2026-10-17T18:00:00Z', 'start')], Date.parse('2026-10-16T12:00:00Z'), 'UTC')).toBe('Starts · Sat 6:00 PM');
        expect(powerLine('start', [mark('2026-10-16T18:00:00Z', 'start')], Date.parse('2026-10-16T12:00:00Z'), 'UTC')).toBe('Starts · Today 6:00 PM');
    });

    it('shows a stop-only schedule as "Stops · daily", and nothing once the only stop has passed', () => {
        expect(powerLine('stop', daily('2026-10-15', 9, 6, 0, 'stop'), FRI_430PM_EDT, NY)).toBe('Stops · daily 2:00 AM');
        expect(powerLine('stop', [mark('2026-10-16T06:00:00Z', 'stop')], Date.parse('2026-10-16T12:00:00Z'), 'UTC')).toBeNull();
    });

    it('reads only its own effect: a daily backup is not a restart', () => {
        expect(powerLine('restart', daily('2026-10-15', 9, 4, 5, 'backup'), FRI_430PM_EDT, NY)).toBeNull();
    });
});

describe('buildServerHours weekly fields (ROK-1877)', () => {
    const other = { ...mine, serverKey: '99' };
    const build = (items: GameServerCalendarItemDto[], state: 'running' | 'offline' = 'running') =>
        buildServerHours({ items, pelicanServerId: 4, state, now: FRI_430PM_EDT, tz: NY });

    it('S1 on the demo seed: "Online now · until 10:00 PM", one "Every day" row, a nightly restart; another server is ignored', () => {
        const hours = build([...demoWindows('2026-10-15', 9), ...daily('2026-10-15', 9, 4, 5, 'restart'), { ...win('2026-10-17T01:00:00Z', '2026-10-17T03:00:00Z'), ...other }]);
        expect(hours.nowLine).toBe('Online now · until 10:00 PM');
        expect(hours.weekRows).toEqual([{ key: '2026-10-16', label: 'Every day', spans: DEMO_SPANS }]);
        expect(hours.restartLine).toBe('Restart · nightly 12:05 AM');
        expect(hours.empty).toBe(false);
    });

    it('S7 start-only: no rows, a "Starts · daily" line, and not the empty state', () => {
        const hours = build(daily('2026-10-15', 9, 22, 0, 'start'));
        expect(hours.weekRows).toEqual([]);
        expect(hours.startLine).toBe('Starts · daily 6:00 PM');
        expect(hours.stopLine).toBeNull();
        expect(hours.nowLine).toBe('Online now');
        expect(hours.empty).toBe(false);
    });

    it('S6 restart only: the empty state with the restart line kept', () => {
        const hours = build(daily('2026-10-15', 9, 4, 5, 'restart'), 'offline');
        expect(hours.empty).toBe(true);
        expect(hours.nowLine).toBe('Offline');
        expect(hours.restartLine).toBe('Restart · nightly 12:05 AM');
    });
});
