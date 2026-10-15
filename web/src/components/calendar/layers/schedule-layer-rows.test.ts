import { describe, it, expect } from 'vitest';
import { mergeScheduleRows } from './schedule-layer-rows';
import type { LayerDayEntry } from './calendar-layer-days';

const ev = (id: number, iso: string) => ({ id, start: new Date(iso) });
const entry = (id: string, iso: string): LayerDayEntry => ({ id, kind: 'marker', at: new Date(iso), tip: { title: id, detail: '' } });

describe('mergeScheduleRows (ROK-1775)', () => {
    it('interleaves layer rows with events by time', () => {
        const rows = mergeScheduleRows(
            [ev(1, '2026-10-14T19:00:00Z'), ev(2, '2026-10-14T23:00:00Z')],
            [entry('restart', '2026-10-14T08:00:00Z'), entry('up', '2026-10-14T22:00:00Z')],
        );
        expect(rows.map((r) => r.key)).toEqual(['l-restart', 'e-1', 'l-up', 'e-2']);
    });

    it('puts a layer row before an event at the same instant', () => {
        const rows = mergeScheduleRows([ev(7, '2026-10-14T20:00:00Z')], [entry('restart', '2026-10-14T20:00:00Z')]);
        expect(rows.map((r) => r.kind)).toEqual(['layer', 'event']);
    });

    it('returns only the events when there are no entries', () => {
        expect(mergeScheduleRows([ev(1, '2026-10-14T19:00:00Z')]).map((r) => r.key)).toEqual(['e-1']);
    });
});
