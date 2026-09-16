/**
 * Pure helpers behind the phone's GROUP day view (ROK-1580).
 *
 * The same aggregate the seven-column heatmap paints, reduced to one day at a
 * time: a keyed lookup, the right-aligned count copy, and the week strip's
 * three bands read from the group rather than from the viewer's own week.
 */
import { describe, it, expect } from 'vitest';
import type { AggregateGameTimeCell } from '@raid-ledger/contract';
import type { HeatmapCellData } from '../../game-time-grid.types';
import {
    groupBandKind, groupBandShares, groupCellBusyLabel, groupCellKey, groupCellShortLabel,
    groupStripLabel, suggestedBlock, toGroupCellMap, type GroupBandShare,
} from '../group-day.utils';

const cell = (
    dayOfWeek: number, hour: number, availableCount: number, totalCount: number,
    staleCount = 0, unknownCount = 0, busyCount = 0,
): AggregateGameTimeCell => ({
    dayOfWeek, hour, availableCount, totalCount, staleCount, unknownCount, busyCount,
});

/** One band descriptor, the shape `groupBandShares` reports. */
const band = (best: number, other: number | null = null, busy = false): GroupBandShare =>
    ({ best, other, busy });

describe('toGroupCellMap', () => {
    it('keys cells the same way the desktop heatmap does', () => {
        const map = toGroupCellMap([cell(2, 19, 3, 4, 1, 0), cell(3, 20, 1, 4, 0, 3)]);
        expect(map.get(groupCellKey(2, 19)))
            .toEqual({ available: 3, total: 4, stale: 1, unknown: 0, busy: 0 });
        expect(map.get('3:20')).toEqual({ available: 1, total: 4, stale: 0, unknown: 3, busy: 0 });
        expect(map.get(groupCellKey(4, 19))).toBeUndefined();
    });

    it('keeps an absent freshness model absent rather than defaulting it to zero', () => {
        const map = toGroupCellMap([{ dayOfWeek: 0, hour: 9, availableCount: 2, totalCount: 5 }]);
        expect(map.get('0:9'))
            .toEqual({ available: 2, total: 5, stale: undefined, unknown: undefined, busy: undefined });
    });

    it('carries the busy count through (ROK-1584)', () => {
        const map = toGroupCellMap([cell(3, 20, 2, 4, 0, 1, 1)]);
        expect(map.get('3:20')?.busy).toBe(1);
    });
});

describe('groupCellShortLabel', () => {
    it('reads the free count, and the stale count only when there is one', () => {
        expect(groupCellShortLabel({ available: 4, total: 4, stale: 0, unknown: 0 })).toBe('4 free');
        expect(groupCellShortLabel({ available: 3, total: 4, stale: 1, unknown: 0 })).toBe('3 free · 1 stale');
    });

    it('says "0 free" for a cell nobody is free in', () => {
        expect(groupCellShortLabel({ available: 0, total: 4, stale: 0, unknown: 4 })).toBe('0 free');
    });

    it('says nothing at all when there is no cell', () => {
        expect(groupCellShortLabel(undefined)).toBe('');
    });
});

describe('groupCellBusyLabel', () => {
    it('is the purple clause of the label — "· 1 busy" — only when someone is busy', () => {
        expect(groupCellBusyLabel({ available: 2, total: 4, stale: 0, unknown: 0, busy: 1 }))
            .toBe(' · 1 busy');
        expect(groupCellBusyLabel({ available: 0, total: 4, stale: 0, unknown: 2, busy: 2 }))
            .toBe(' · 2 busy');
    });

    it('is empty when nobody is busy, when the field is absent, and when there is no cell', () => {
        expect(groupCellBusyLabel({ available: 2, total: 4, busy: 0 })).toBe('');
        expect(groupCellBusyLabel({ available: 2, total: 4 })).toBe('');
        expect(groupCellBusyLabel(undefined)).toBe('');
    });
});

describe('groupBandShares', () => {
    it('reports each band’s BEST hour of known coverage (free + stale), so the bar agrees with the cells', () => {
        const cells: AggregateGameTimeCell[] = [
            // Evening band is 17..20: one hour fully known, one half known, two missing.
            cell(2, 17, 4, 4), cell(2, 18, 2, 4, 2),
            // Late band is 21..25: one hour half-known.
            cell(2, 21, 2, 4),
        ];
        const shares = groupBandShares(toGroupCellMap(cells), 2);
        expect(shares[0].best).toBe(0); // 9 AM–5 PM — nothing known
        expect(shares[1].best).toBe(1); // the 5 PM cell is everyone → the band reads "all"
        expect(shares[2].best).toBe(0.5); // one half-known hour → "few", not 0.1
    });

    it('does not let empty hours drag a good band down (the operator’s Wednesday)', () => {
        // 5 PM, 7 PM, 10 PM empty; 8–9 PM two of three known → amber cells → amber bar.
        const cells = [cell(3, 20, 1, 3, 1), cell(3, 21, 1, 3, 1)];
        const shares = groupBandShares(toGroupCellMap(cells), 3);
        expect(groupBandKind(shares[1].best)).toBe('most');
    });

    it('treats a zero-total cell as no coverage rather than dividing by zero', () => {
        const shares = groupBandShares(toGroupCellMap([cell(1, 17, 0, 0)]), 1);
        expect(shares.every((s) => Number.isFinite(s.best))).toBe(true);
        expect(shares[1].best).toBe(0);
    });

    // ROK-1584: one bar per band hid the disagreement inside it — an evening
    // that is amber at 8 PM and red at 10 PM wore one amber bar.
    it('reports the LOWEST hour of a differing kind as the band’s other tone', () => {
        // Evening 17..20: 5 PM everyone, 6 PM a few (1/4), 7 PM fewer still (1/8 → still "few").
        const cells = [cell(2, 17, 4, 4), cell(2, 18, 1, 4), cell(2, 19, 1, 8)];
        const shares = groupBandShares(toGroupCellMap(cells), 2);
        expect(groupBandKind(shares[1].best)).toBe('all');
        expect(shares[1].other).toBe(0.125);
        expect(groupBandKind(shares[1].other as number)).toBe('few');
    });

    it('has no other tone when every known hour of the band reads the same', () => {
        const shares = groupBandShares(toGroupCellMap([cell(2, 17, 4, 4), cell(2, 18, 4, 4)]), 2);
        expect(shares[1].other).toBeNull();
    });

    it('flags a band with a busy hour, on any hour of it', () => {
        const shares = groupBandShares(toGroupCellMap([cell(2, 20, 2, 4, 0, 0, 1)]), 2);
        expect(shares[1].busy).toBe(true);
        expect(shares[0].busy).toBe(false);
    });
});

describe('groupBandKind', () => {
    it('mirrors computeHeatmapBg’s thresholds', () => {
        expect(groupBandKind(1)).toBe('all');
        expect(groupBandKind(0.9995)).toBe('all');
        expect(groupBandKind(0.75)).toBe('most');
        expect(groupBandKind(0.5)).toBe('few');
        expect(groupBandKind(0.01)).toBe('few');
        expect(groupBandKind(0)).toBe('none');
    });
});

describe('groupStripLabel', () => {
    it('names the day, the best band on it, and how free that band is', () => {
        expect(groupStripLabel(3, [band(0), band(0.75), band(0.25)]))
            .toBe('Wednesday, evening: most free');
        expect(groupStripLabel(6, [band(1), band(0.25), band(0)]))
            .toBe('Saturday, daytime: everyone free');
        expect(groupStripLabel(1, [band(0), band(0), band(0.25)]))
            .toBe('Monday, late night: a few free');
    });

    it('drops the band name when nobody is free anywhere that day', () => {
        expect(groupStripLabel(0, [band(0), band(0), band(0)])).toBe('Sunday, nobody free');
    });

    // The design's own example (§2): the bar is two-tone AND capped purple.
    it('speaks the two tones and the busy cap', () => {
        expect(groupStripLabel(3, [band(0), band(0.75, 0.25, true), band(0.25)]))
            .toBe('Wednesday, evening: most to a few free, busy');
    });

    it('says the day is busy even when the busy band is not the best one', () => {
        expect(groupStripLabel(3, [band(0, null, true), band(0.75), band(0)]))
            .toBe('Wednesday, evening: most free, busy');
    });
});

describe('suggestedBlock', () => {
    const HOURS = [17, 18, 19, 20, 21, 22, 23];

    it('runs two hours from the tapped hour', () => {
        expect(suggestedBlock(20, HOURS)).toEqual({ startIndex: 3, endIndex: 5 });
    });

    it('clamps to the end of the visible range', () => {
        expect(suggestedBlock(23, HOURS)).toEqual({ startIndex: 6, endIndex: 7 });
    });

    it('is null for an hour the day is not showing', () => {
        expect(suggestedBlock(9, HOURS)).toBeNull();
    });
});

/** Compile-time guard: the map value is the type the heatmap helpers consume. */
const _typed: Map<string, HeatmapCellData> = toGroupCellMap([]);
void _typed;
