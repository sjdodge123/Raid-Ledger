/** ROK-1876 L3 — the server-hours widget's pure model: server filter, now line, day rows, restart line. */
import { describe, expect, it } from 'vitest';
import type { GameServerCalendarItemDto } from '@raid-ledger/contract';
import { buildServerHours, hoursRange } from './server-hours.helpers';

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

    it('says when the next window opens, or when the open one closes', () => {
        expect(build().nowLine).toBe('Offline · opens 6:00 PM');
        expect(build({ state: 'running', now: Date.parse('2026-10-14T20:00:00Z') }).nowLine).toBe('Online · closes Thu 2:00 AM');
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
        expect(hours.nowLine).toBe('Online');
        expect(hours.restartLine).toBeNull();
    });

    it('asks for seven days from now', () => {
        expect(hoursRange(WED_NOON)).toEqual({ from: '2026-10-14T12:00:00.000Z', to: '2026-10-21T12:00:00.000Z' });
    });
});
