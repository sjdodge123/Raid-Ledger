import { describe, it, expect } from 'vitest';
import type { CalendarLayerItem, CalendarLayerMarker, CalendarLayerWindow } from '../../../plugins/calendar-layer';
import {
    chooseTipSide, isLayerEvent, markersForColumn, splitAtMidnight, toLayerBackgroundEvents, zonedMarkers,
} from './calendar-layer-events';

const NY = 'America/New_York';

function win(id: string, start: string, end: string): CalendarLayerWindow {
    return { kind: 'window', id, start, end, label: `Server up · ${id}`, ariaLabel: `Server ${id} up` };
}

function marker(id: string, at: string): CalendarLayerMarker {
    return { kind: 'marker', id, at, glyph: 'power', tip: { title: `Restart · ${id}`, detail: 'Online · checked 2 min ago' } };
}

describe('isLayerEvent', () => {
    it('is true for a layer window event and false for a calendar event', () => {
        const [layerEvent] = toLayerBackgroundEvents([win('a', '2026-02-10T20:00:00Z', '2026-02-10T22:00:00Z')], 'UTC');
        expect(layerEvent && isLayerEvent(layerEvent)).toBe(true);
        expect(isLayerEvent({ id: 1, title: 'Raid', resource: {} })).toBe(false);
    });
});

describe('toLayerBackgroundEvents', () => {
    it('zones a window into the user timezone', () => {
        const events = toLayerBackgroundEvents([win('a', '2026-02-10T23:00:00Z', '2026-02-11T03:00:00Z')], NY);
        expect(events).toHaveLength(1);
        expect(events[0]?.start.getHours()).toBe(18);
        expect(events[0]?.end.getHours()).toBe(22);
        expect(events[0]?.title).toBe('Server up · a');
        expect(events[0]?.continued).toBe(false);
    });

    it('splits a window crossing local midnight and marks the carried segment "(cont.)"', () => {
        const events = toLayerBackgroundEvents([win('a', '2026-02-10T23:00:00Z', '2026-02-11T03:00:00Z')], 'UTC');
        expect(events.map((e) => [e.id, e.title, e.continued, new Date(e.start.getTime()).toISOString(), new Date(e.end.getTime()).toISOString()])).toEqual([
            ['a', 'Server up · a', false, '2026-02-10T23:00:00.000Z', '2026-02-11T00:00:00.000Z'],
            ['a#1', 'Server up · a (cont.)', true, '2026-02-11T00:00:00.000Z', '2026-02-11T03:00:00.000Z'],
        ]);
    });

    it('ignores markers and keeps a reference to the source window', () => {
        const w = win('a', '2026-02-10T20:00:00Z', '2026-02-10T22:00:00Z');
        const items: CalendarLayerItem[] = [marker('m', '2026-02-10T21:00:00Z'), w];
        const events = toLayerBackgroundEvents(items, 'UTC');
        expect(events).toHaveLength(1);
        expect(events[0]?.layer).toBe(w);
    });
});

describe('splitAtMidnight', () => {
    it('returns nothing for an empty or inverted span', () => {
        const t = new Date('2026-02-10T10:00:00Z');
        expect(splitAtMidnight(t, t)).toEqual([]);
        expect(splitAtMidnight(t, new Date('2026-02-10T09:00:00Z'))).toEqual([]);
    });
});

describe('zonedMarkers + markersForColumn', () => {
    const markers = zonedMarkers([
        marker('late', '2026-02-11T04:59:00Z'), // 23:59 Feb 10 in New York
        marker('midnight', '2026-02-11T05:00:00Z'), // 00:00 Feb 11 in New York
        marker('bad', 'not-a-date'),
        win('w', '2026-02-10T20:00:00Z', '2026-02-10T22:00:00Z'),
    ], NY);

    it('resolves day and minute of day in the user timezone and drops invalid times', () => {
        expect(markers.map((m) => [m.id, m.dayKey, m.minuteOfDay])).toEqual([
            ['late', '2026-02-10', 1439],
            ['midnight', '2026-02-11', 0],
        ]);
    });

    it('buckets a 23:59 and a 00:00 marker into their own day columns', () => {
        expect(markersForColumn(markers, new Date(2026, 1, 10)).map((m) => m.id)).toEqual(['late']);
        expect(markersForColumn(markers, new Date(2026, 1, 11)).map((m) => m.id)).toEqual(['midnight']);
        expect(markersForColumn(markers, new Date(2026, 1, 12))).toEqual([]);
    });
});

describe('chooseTipSide', () => {
    it('opens left when the 256px tip + 8px gap would pass the boundary', () => {
        expect(chooseTipSide({ anchorRight: 900, boundaryRight: 1000 })).toBe('left');
        expect(chooseTipSide({ anchorRight: 737, boundaryRight: 1000 })).toBe('left');
    });

    it('opens right when the tip fits exactly', () => {
        expect(chooseTipSide({ anchorRight: 736, boundaryRight: 1000 })).toBe('right');
    });

    it("opens right for Day view's left-edge glyph on a phone", () => {
        expect(chooseTipSide({ anchorRight: 80, boundaryRight: 375 })).toBe('right');
    });
});
