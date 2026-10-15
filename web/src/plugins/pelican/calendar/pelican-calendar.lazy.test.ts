import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { GAME_SERVER_CALENDAR_MAX_RANGE_DAYS, type GameServerCalendarItemDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { GAME_SERVERS_CALENDAR_URL } from '../../../test/mocks/pelican-handlers';
import { fetchServerCalendar } from './pelican-calendar.lazy';
import { splitCalendarRange } from './pelican-calendar-range.helpers';

const DAY_MS = 86_400_000;
const base = { serverKey: 'srv-1', serverName: 'Valheim Dedicated', gameId: 7, provider: 'pelican' };
const win = (start: string, end: string): GameServerCalendarItemDto =>
    ({ kind: 'window', ...base, start, end, label: 'up', source: 'schedule' });
const marker = (at: string): GameServerCalendarItemDto => ({ kind: 'marker', ...base, at, effect: 'restart', label: 'restart' });

/** Every item the fake server knows; it answers like the real one (window overlaps, marker inside `[from, to)`). */
const ALL: GameServerCalendarItemDto[] = [
    marker('2026-10-05T12:00:00Z'),
    win('2026-12-01T22:00:00Z', '2026-12-02T06:00:00Z'),
    marker('2026-12-20T12:00:00Z'),
];

function inRange(item: GameServerCalendarItemDto, from: number, to: number): boolean {
    if (item.kind === 'window') return Date.parse(item.start) < to && Date.parse(item.end) > from;
    const at = Date.parse(item.at);
    return at >= from && at < to;
}

let spans: number[] = [];
beforeEach(() => {
    spans = [];
    server.use(http.get(GAME_SERVERS_CALENDAR_URL, ({ request }) => {
        const url = new URL(request.url);
        const from = Date.parse(url.searchParams.get('from') ?? '');
        const to = Date.parse(url.searchParams.get('to') ?? '');
        spans.push((to - from) / DAY_MS);
        return HttpResponse.json({ data: ALL.filter((item) => inRange(item, from, to)) });
    }));
});

describe('fetchServerCalendar — range cap (ROK-1775, Codex P1)', () => {
    it('splits a 90-day Schedule range into requests within the API cap and merges the items', async () => {
        // A window spanning the chunk boundary (Dec 1 22:00 → Dec 2 06:00) comes back from both chunks.
        const range = { from: '2026-10-01T04:00:00.000Z', to: '2026-12-30T04:00:00.000Z' };
        expect(splitCalendarRange(range).map((r) => r.from)).toContain('2026-12-02T04:00:00.000Z');
        const items = await fetchServerCalendar(range);
        expect(spans.length).toBeGreaterThanOrEqual(2);
        expect(spans.filter((days) => days > GAME_SERVER_CALENDAR_MAX_RANGE_DAYS)).toEqual([]);
        expect(items).toEqual(ALL);
    });

    it('sends a range within the cap as one request', async () => {
        await fetchServerCalendar({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' });
        expect(spans).toEqual([38]);
    });
});

describe('splitCalendarRange', () => {
    it('covers the range contiguously, ending on the exact `to`', () => {
        const range = { from: '2026-10-01T00:00:00.000Z', to: '2026-12-31T23:59:59.999Z' };
        const chunks = splitCalendarRange(range, 62);
        expect(chunks[0]?.from).toBe(range.from);
        expect(chunks.at(-1)?.to).toBe(range.to);
        expect(chunks.slice(1).map((c) => c.from)).toEqual(chunks.slice(0, -1).map((c) => c.to));
    });
});
