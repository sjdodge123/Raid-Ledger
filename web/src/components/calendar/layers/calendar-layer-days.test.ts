import { describe, it, expect } from 'vitest';
import type { CalendarLayerItem } from '../../../plugins/calendar-layer';
import { groupLayerItemsByDay, NO_LAYER_DAYS } from './calendar-layer-days';

const TZ = 'America/New_York';

function win(id: string, start: string, end: string): CalendarLayerItem {
    return { kind: 'window', id, start, end, label: 'Server up · Valheim Dedicated', ariaLabel: id };
}

function marker(id: string, at: string, title: string): CalendarLayerItem {
    return { kind: 'marker', id, at, glyph: 'power', tip: { title, detail: 'Online · checked 2 min ago' } };
}

function titles(days: ReturnType<typeof groupLayerItemsByDay>, key: string): string[] {
    return (days.get(key) ?? []).map((e) => e.tip.title);
}

describe('groupLayerItemsByDay (ROK-1775)', () => {
    it('returns the shared empty map for no items', () => {
        expect(groupLayerItemsByDay([], TZ)).toBe(NO_LAYER_DAYS);
    });

    it('counts a window crossing local midnight on EACH day it touches, with its real start–end', () => {
        // 6 PM → 2 AM New York (EDT, -04:00).
        const days = groupLayerItemsByDay([win('w1', '2026-10-14T22:00:00Z', '2026-10-15T06:00:00Z')], TZ);
        const title = 'Server up · Valheim Dedicated · 6:00 PM – 2:00 AM';
        expect(titles(days, '2026-10-14')).toEqual([title]);
        expect(titles(days, '2026-10-15')).toEqual([title]);
        expect([...days.keys()]).toEqual(['2026-10-14', '2026-10-15']);
    });

    it('buckets a marker by the VIEWER\'s local day, not UTC', () => {
        // 02:30Z on the 15th is 10:30 PM on the 14th in New York.
        const days = groupLayerItemsByDay([marker('m1', '2026-10-15T02:30:00Z', 'Restart · Valheim Dedicated · 10:30 PM')], TZ);
        expect(titles(days, '2026-10-14')).toEqual(['Restart · Valheim Dedicated · 10:30 PM']);
        expect(days.has('2026-10-15')).toBe(false);
    });

    it('sorts a day\'s entries by time, a carried-over window first at midnight', () => {
        const days = groupLayerItemsByDay([
            win('w-late', '2026-10-15T22:00:00Z', '2026-10-16T02:00:00Z'),
            marker('m-restart', '2026-10-15T08:05:00Z', 'Restart · Valheim Dedicated · 4:05 AM'),
            win('w-carry', '2026-10-15T00:00:00Z', '2026-10-15T06:00:00Z'),
        ], TZ);
        expect(titles(days, '2026-10-15')).toEqual([
            'Server up · Valheim Dedicated · 8:00 PM – 2:00 AM', // carried-over segment (14th 8 PM → 15th 2 AM) sorts at 00:00
            'Restart · Valheim Dedicated · 4:05 AM',
            'Server up · Valheim Dedicated · 6:00 PM – 10:00 PM',
        ]);
    });

    it('drops an item with an unparseable time instead of throwing', () => {
        expect(groupLayerItemsByDay([marker('bad', 'not-a-date', 'x')], TZ).size).toBe(0);
    });
});
