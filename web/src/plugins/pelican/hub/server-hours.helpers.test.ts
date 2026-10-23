/** ROK-1876 L3 / ROK-1877 L1 — the server-hours widget's pure model: server filter, now line, day rows, restart line. */
import { describe, expect, it } from 'vitest';
import type { GameServerCalendarItemDto } from '@raid-ledger/contract';
import { buildServerHours, hoursRange, nowModel } from './server-hours.helpers';

const mine = { serverKey: '4', serverName: 'Valheim', gameId: 7, provider: 'pelican' };
const other = { ...mine, serverKey: '99', serverName: 'Other' };
const items: GameServerCalendarItemDto[] = [
    { kind: 'window', ...mine, start: '2026-10-14T18:00:00Z', end: '2026-10-15T02:00:00Z', label: 'Evening', source: 'schedule' },
    { kind: 'window', ...mine, start: '2026-10-15T13:00:00Z', end: '2026-10-15T13:40:00Z', label: 'Midday', source: 'schedule' },
    { kind: 'window', ...other, start: '2026-10-16T10:00:00Z', end: '2026-10-16T12:00:00Z', label: 'Other', source: 'schedule' },
    { kind: 'marker', ...mine, at: '2026-10-15T04:05:00Z', effect: 'restart', label: 'Nightly restart' },
    { kind: 'marker', ...mine, at: '2026-10-15T04:05:30Z', effect: 'backup', label: 'Nightly backup' },
    { kind: 'marker', ...other, at: '2026-10-14T13:00:00Z', effect: 'restart', label: 'Other restart' },
];
const WED_NOON = Date.parse('2026-10-14T12:00:00Z');
const build = (over: Partial<Parameters<typeof buildServerHours>[0]> = {}) =>
    buildServerHours({ items, pelicanServerId: 4, state: 'offline', now: WED_NOON, tz: 'UTC', ...over });

describe('buildServerHours (ROK-1876)', () => {
    it('lists one row per day for this server only, in the viewer timezone', () => {
        expect(build().days).toEqual([
            { key: '2026-10-14', day: 'Today', spans: '6:00 PM – 2:00 AM' },
            { key: '2026-10-15', day: 'Thu', spans: '1:00 PM – 1:40 PM' },
        ]);
        expect(build({ tz: 'America/New_York' }).days[0]).toEqual({ key: '2026-10-14', day: 'Today', spans: '2:00 PM – 10:00 PM' });
    });

    it('says when the next window is up, or until when the open one runs (ROK-1877 Q7)', () => {
        expect(build().nowLine).toBe('Offline · next up 6:00 PM');
        expect(build({ state: 'running', now: Date.parse('2026-10-14T20:00:00Z') }).nowLine).toBe('Online now · until Thu 2:00 AM');
    });

    it('drops windows that already ended and keeps an open one under today', () => {
        const days = build({ now: Date.parse('2026-10-15T01:00:00Z') }).days;
        expect(days).toEqual([{ key: '2026-10-15', day: 'Today', spans: '6:00 PM – 2:00 AM, 1:00 PM – 1:40 PM' }]);
    });

    it('shows the next restart of this server, ignoring other effects and servers', () => {
        expect(build().restartLine).toBe('Restart · Thu 4:05 AM');
        expect(build({ now: Date.parse('2026-10-15T05:00:00Z') }).restartLine).toBeNull();
    });

    it('has no day rows when the server has no windows (the empty state)', () => {
        const hours = build({ pelicanServerId: 5, state: 'running' });
        expect(hours.days).toEqual([]);
        expect(hours.nowLine).toBe('Online now');
        expect(hours.restartLine).toBeNull();
    });

    it('splits a multi-day window into one row per local day instead of one overnight span (Codex r1 P2)', () => {
        // Sun 22:00 → next Sun 06:00 UTC (a daily start paired with a Sunday stop).
        const long: GameServerCalendarItemDto[] = [
            { kind: 'window', ...mine, start: '2026-10-11T22:00:00Z', end: '2026-10-18T06:00:00Z', label: 'Week', source: 'schedule' },
        ];
        expect(build({ items: long }).days).toEqual([
            { key: '2026-10-14', day: 'Today', spans: 'All day' },
            { key: '2026-10-15', day: 'Thu', spans: 'All day' },
            { key: '2026-10-16', day: 'Fri', spans: 'All day' },
            { key: '2026-10-17', day: 'Sat', spans: 'All day' },
            { key: '2026-10-18', day: 'Sun', spans: 'until 6:00 AM' },
        ]);
        const fromSat = build({ items: long, now: Date.parse('2026-10-10T12:00:00Z') }).days;
        expect(fromSat[0]).toEqual({ key: '2026-10-11', day: 'Sun', spans: 'from 10:00 PM' });
        expect(fromSat.map((d) => d.key)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    });

    it('drops the empty tail when a multi-day window ends exactly at midnight', () => {
        const toMidnight: GameServerCalendarItemDto[] = [
            { kind: 'window', ...mine, start: '2026-10-14T18:00:00Z', end: '2026-10-16T00:00:00Z', label: 'Two days', source: 'schedule' },
        ];
        expect(build({ items: toMidnight }).days).toEqual([
            { key: '2026-10-14', day: 'Today', spans: 'from 6:00 PM' },
            { key: '2026-10-15', day: 'Thu', spans: 'All day' },
        ]);
    });

    it('shows a same-day 24h window on a 25h fall-back day as one "from – until" span (review fix-delta NIT)', () => {
        // 2026-11-01 is the US fall-back day: 12:30 AM EDT (04:30Z) → 11:30 PM EST (Nov 2 04:30Z) is 24h on one local day.
        const fallBack: GameServerCalendarItemDto[] = [
            { kind: 'window', ...mine, start: '2026-11-01T04:30:00Z', end: '2026-11-02T04:30:00Z', label: 'Long day', source: 'schedule' },
        ];
        const days = build({ items: fallBack, now: Date.parse('2026-10-31T12:00:00Z'), tz: 'America/New_York' }).days;
        expect(days).toEqual([{ key: '2026-11-01', day: 'Sun', spans: '12:30 AM – 11:30 PM' }]);
    });
});

describe('hoursRange', () => {
    it('asks for seven days ahead plus 26h of look-behind, so today\'s earlier windows count towards its pattern (ROK-1877)', () => {
        expect(hoursRange(WED_NOON)).toEqual({ from: '2026-10-13T10:00:00.000Z', to: '2026-10-21T12:00:00.000Z' });
    });
});

/** ROK-1877 §3 — the now line: live state first, schedule second, never contradictory. */
describe('nowModel (ROK-1877)', () => {
    const evening = [items[0], items[1]].filter((i): i is Extract<GameServerCalendarItemDto, { kind: 'window' }> => i?.kind === 'window');
    const at = (iso: string) => Date.parse(iso);
    const model = (state: Parameters<typeof nowModel>[0], iso: string, tz = 'UTC') => nowModel(state, evening, at(iso), tz);

    it('S1 online in hours: "Online now · until" the end, with the weekday when it ends on another day', () => {
        expect(model('running', '2026-10-15T13:10:00Z')).toEqual({ tone: 'online', head: 'Online now', tail: 'until 1:40 PM', sub: null });
        expect(model('running', '2026-10-14T20:00:00Z').tail).toBe('until Thu 2:00 AM');
    });

    it('S2 offline before a window: "Offline · next up", today without a weekday, another day with one', () => {
        expect(model('offline', '2026-10-14T12:00:00Z')).toEqual({ tone: 'offline', head: 'Offline', tail: 'next up 6:00 PM', sub: null });
        expect(model('offline', '2026-10-15T03:00:00Z', 'America/New_York').tail, 'still Wed 11 PM in New York').toBe('next up Thu 9:00 AM');
        expect(model('offline', '2026-10-15T03:00:00Z').tail).toBe('next up 1:00 PM');
        expect(model('offline', '2026-10-15T03:00:00Z', 'Asia/Tokyo').tail, 'noon Thu in Tokyo, the window is 10 PM the same day').toBe('next up 10:00 PM');
    });

    it('S2 on another day names the weekday', () => {
        expect(nowModel('offline', evening.slice(1), at('2026-10-14T12:00:00Z'), 'UTC').tail).toBe('next up Thu 1:00 PM');
    });

    it('S3 manual start outside its hours: no "opens" contradiction, the next window moves to a sub-line', () => {
        expect(model('running', '2026-10-15T05:00:00Z')).toEqual({ tone: 'online', head: 'Online now', tail: 'outside its usual hours', sub: 'Next scheduled: 1:00 PM' });
        expect(model('running', '2026-10-14T12:00:00Z').sub).toBe('Next scheduled: 6:00 PM');
    });

    it('S4 down inside its hours: a warning tone and "usually up until"', () => {
        expect(model('offline', '2026-10-14T20:00:00Z')).toEqual({ tone: 'warn', head: 'Offline', tail: 'usually up until Thu 2:00 AM', sub: null });
    });

    it('S5 starting/stopping and S8 unknown: a neutral head with the S1/S2 schedule tail', () => {
        expect(model('starting', '2026-10-14T20:00:00Z')).toEqual({ tone: 'neutral', head: 'Starting…', tail: 'until Thu 2:00 AM', sub: null });
        expect(model('stopping', '2026-10-14T12:00:00Z')).toEqual({ tone: 'neutral', head: 'Stopping…', tail: 'next up 6:00 PM', sub: null });
        expect(model('unknown', '2026-10-14T12:00:00Z')).toEqual({ tone: 'neutral', head: 'Status unknown', tail: 'next up 6:00 PM', sub: null });
    });

    it('S6 no windows ahead: the live state alone, never "outside its usual hours"', () => {
        expect(model('running', '2026-10-16T00:00:00Z')).toEqual({ tone: 'online', head: 'Online now', tail: null, sub: null });
        expect(model('offline', '2026-10-16T00:00:00Z')).toEqual({ tone: 'offline', head: 'Offline', tail: null, sub: null });
        expect(nowModel('unknown', [], at('2026-10-16T00:00:00Z'), 'UTC')).toEqual({ tone: 'neutral', head: 'Status unknown', tail: null, sub: null });
    });
});
