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
    groupBandKind, groupBandShares, groupCellKey, groupCellShortLabel, groupStripLabel,
    suggestedBlock, toGroupCellMap,
} from '../group-day.utils';

const cell = (
    dayOfWeek: number, hour: number, availableCount: number, totalCount: number,
    staleCount = 0, unknownCount = 0,
): AggregateGameTimeCell => ({ dayOfWeek, hour, availableCount, totalCount, staleCount, unknownCount });

describe('toGroupCellMap', () => {
    it('keys cells the same way the desktop heatmap does', () => {
        const map = toGroupCellMap([cell(2, 19, 3, 4, 1, 0), cell(3, 20, 1, 4, 0, 3)]);
        expect(map.get(groupCellKey(2, 19))).toEqual({ available: 3, total: 4, stale: 1, unknown: 0 });
        expect(map.get('3:20')).toEqual({ available: 1, total: 4, stale: 0, unknown: 3 });
        expect(map.get(groupCellKey(4, 19))).toBeUndefined();
    });

    it('keeps an absent freshness model absent rather than defaulting it to zero', () => {
        const map = toGroupCellMap([{ dayOfWeek: 0, hour: 9, availableCount: 2, totalCount: 5 }]);
        expect(map.get('0:9')).toEqual({ available: 2, total: 5, stale: undefined, unknown: undefined });
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

describe('groupBandShares', () => {
    it('reports each band’s BEST hour of known coverage (free + stale), so the bar agrees with the cells', () => {
        const cells: AggregateGameTimeCell[] = [
            // Evening band is 17..20: one hour fully known, one half known, two missing.
            cell(2, 17, 4, 4), cell(2, 18, 2, 4, 2),
            // Late band is 21..25: one hour half-known.
            cell(2, 21, 2, 4),
        ];
        const shares = groupBandShares(toGroupCellMap(cells), 2);
        expect(shares[0]).toBe(0); // 9 AM–5 PM — nothing known
        expect(shares[1]).toBe(1); // the 5 PM cell is everyone → the band reads "all"
        expect(shares[2]).toBe(0.5); // one half-known hour → "few", not 0.1
    });

    it('does not let empty hours drag a good band down (the operator’s Wednesday)', () => {
        // 5 PM, 7 PM, 10 PM empty; 8–9 PM two of three known → amber cells → amber bar.
        const cells = [cell(3, 20, 1, 3, 1), cell(3, 21, 1, 3, 1)];
        const shares = groupBandShares(toGroupCellMap(cells), 3);
        expect(groupBandKind(shares[1])).toBe('most');
    });

    it('treats a zero-total cell as no coverage rather than dividing by zero', () => {
        const shares = groupBandShares(toGroupCellMap([cell(1, 17, 0, 0)]), 1);
        expect(shares.every((s) => Number.isFinite(s))).toBe(true);
        expect(shares[1]).toBe(0);
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
    it('names the day and the best band on it', () => {
        expect(groupStripLabel(3, ['none', 'most', 'few'])).toBe('Wednesday, most free');
        expect(groupStripLabel(0, ['none', 'none', 'none'])).toBe('Sunday, nobody free');
        expect(groupStripLabel(6, ['all', 'few', 'none'])).toBe('Saturday, everyone free');
        expect(groupStripLabel(1, ['none', 'few', 'none'])).toBe('Monday, a few free');
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
