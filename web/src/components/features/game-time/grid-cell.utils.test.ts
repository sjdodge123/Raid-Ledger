/**
 * Tests for grid-cell heatmap helpers (ROK-1560).
 * Fill = fresh availability; hatch = stale + unknown members.
 */
import { describe, it, expect } from 'vitest';
import {
    computeHeatmapBg,
    computeHeatmapHatch,
    computeHeatmapLabel,
    computeCellStyle,
} from './grid-cell.utils';

describe('computeHeatmapHatch (ROK-1560)', () => {
    it('returns undefined when the cell has no heatmap data at all', () => {
        expect(computeHeatmapHatch(undefined)).toBeUndefined();
    });

    it('returns undefined for a legacy cell without stale/unknown counts', () => {
        expect(computeHeatmapHatch({ available: 2, total: 4 })).toBeUndefined();
    });

    it('returns undefined when stale + unknown is zero', () => {
        expect(computeHeatmapHatch({ available: 3, total: 3, stale: 0, unknown: 0 })).toBeUndefined();
    });

    it('returns a hatch gradient when the cell has stale members', () => {
        const hatch = computeHeatmapHatch({ available: 1, total: 3, stale: 2, unknown: 0 });
        expect(hatch, 'cell 1/3 with 2 stale members must render a hatch').toMatch(/repeating-linear-gradient/);
    });

    it('returns a hatch gradient when the cell has only unknown members', () => {
        const hatch = computeHeatmapHatch({ available: 1, total: 3, stale: 0, unknown: 2 });
        expect(hatch, 'cell 1/3 with 2 unknown members must render a hatch').toMatch(/repeating-linear-gradient/);
    });

    it('paints the hatch from colour tokens only — never a raw hex or rgba', () => {
        const hatch = computeHeatmapHatch({ available: 1, total: 6, stale: 3, unknown: 2 }) ?? '';
        expect(hatch).toContain('var(--color-muted)');
        expect(hatch).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    });

    it('hatches denser as the uncertain share of the group grows', () => {
        const light = computeHeatmapHatch({ available: 5, total: 6, stale: 1, unknown: 0 }) ?? '';
        const heavy = computeHeatmapHatch({ available: 1, total: 6, stale: 5, unknown: 0 }) ?? '';
        const pct = (s: string): number => Number(/(\d+)%/.exec(s)?.[1] ?? 0);
        expect(pct(heavy)).toBeGreaterThan(pct(light));
    });
});

describe('computeHeatmapBg with the freshness model (ROK-1560)', () => {
    it('is unchanged for a cell without the new fields', () => {
        expect(computeHeatmapBg({ available: 3, total: 4 })).toMatch(/rgba\(234, 179, 8/);
        expect(computeHeatmapBg({ available: 2, total: 4 })).toMatch(/rgba\(239, 68, 68/); // exactly 0.5 is the red band
        expect(computeHeatmapBg({ available: 4, total: 4 })).toMatch(/rgba\(34, 197, 94/);
        // legacy 0-available keeps the old red ramp (events aggregate)
        expect(computeHeatmapBg({ available: 0, total: 4 })).toMatch(/rgba\(239, 68, 68/);
    });

    it('draws NO fill for a cell with zero fresh members in freshness mode (hatch only)', () => {
        expect(computeHeatmapBg({ available: 0, total: 4, stale: 2, unknown: 1 })).toBeUndefined();
        expect(computeHeatmapBg({ available: 0, total: 4, stale: 0, unknown: 4 })).toBeUndefined();
    });

    it('shades from fresh availability only — stale members do not brighten the fill', () => {
        const withStale = computeHeatmapBg({ available: 1, total: 4, stale: 3, unknown: 0 });
        expect(withStale).toBe(computeHeatmapBg({ available: 1, total: 4 }));
    });
});

describe('computeHeatmapLabel (ROK-1560)', () => {
    it('returns undefined without heatmap data', () => {
        expect(computeHeatmapLabel(undefined)).toBeUndefined();
    });

    it('keeps the legacy copy when the freshness counts are absent', () => {
        expect(computeHeatmapLabel({ available: 2, total: 5 })).toBe('2 of 5 players available');
    });

    it('reads "3 free · 6 unknown" when stale and unknown counts are present', () => {
        expect(computeHeatmapLabel({ available: 3, total: 9, stale: 2, unknown: 4 })).toBe('3 free · 6 unknown');
    });

    it('still reads "N free · 0 unknown" when everyone is fresh', () => {
        expect(computeHeatmapLabel({ available: 3, total: 3, stale: 0, unknown: 0 })).toBe('3 free · 0 unknown');
    });
});

describe('computeCellStyle with a hatch (ROK-1560)', () => {
    it('layers the hatch as a backgroundImage alongside the fill', () => {
        const style = computeCellStyle([], 'rgba(34, 197, 94, 0.5)', 'repeating-linear-gradient(45deg, red 0 2px)');
        expect(style?.backgroundColor).toBe('rgba(34, 197, 94, 0.5)');
        expect(style?.backgroundImage).toBe('repeating-linear-gradient(45deg, red 0 2px)');
    });

    it('omits backgroundImage when there is no hatch', () => {
        const style = computeCellStyle([], 'rgba(34, 197, 94, 0.5)', undefined);
        expect(style?.backgroundImage).toBeUndefined();
    });
});
