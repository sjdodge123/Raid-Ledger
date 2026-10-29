import { describe, expect, it } from 'vitest';
import { masonryRowSpan, packMasonry } from './masonry-pack';

describe('masonryRowSpan — height + gap → row tracks', () => {
    it('reserves the card height plus one gap, rounded up to whole tracks', () => {
        expect(masonryRowSpan(100, 16, 2)).toBe(58);
        expect(masonryRowSpan(101, 16, 2)).toBe(59);
    });

    it('ignores sub-pixel float noise instead of adding a whole track', () => {
        expect(masonryRowSpan(100.0000001, 16, 2)).toBe(58);
    });

    it('returns 0 for an empty cell or an unusable row unit', () => {
        expect(masonryRowSpan(0, 16, 2)).toBe(0);
        expect(masonryRowSpan(100, 16, 0)).toBe(0);
        expect(masonryRowSpan(Number.NaN, 16, 2)).toBe(0);
    });
});

describe('packMasonry — keep order and span, slide up under the card above', () => {
    it('puts each card in the column the row layout gave it, directly under the card above', () => {
        // 3 columns: A B C on the first row; D goes under A, E under B — not under the shortest column.
        const placed = packMasonry([
            { height: 100, span: 1 }, { height: 300, span: 1 }, { height: 50, span: 1 },
            { height: 100, span: 1 }, { height: 100, span: 1 },
        ], 3, 16, 2);
        expect(placed).toEqual([
            { column: 1, row: 1, rowSpan: 58 },
            { column: 2, row: 1, rowSpan: 158 },
            { column: 3, row: 1, rowSpan: 33 },
            { column: 1, row: 59, rowSpan: 58 },
            { column: 2, row: 159, rowSpan: 58 },
        ]);
    });

    it('wraps a wide card that does not fit the rest of the row and starts it under the taller of its columns', () => {
        const placed = packMasonry([
            { height: 100, span: 1 }, { height: 200, span: 2 }, { height: 40, span: 1 },
        ], 2, 16, 2);
        expect(placed).toEqual([
            { column: 1, row: 1, rowSpan: 58 },
            { column: 1, row: 59, rowSpan: 108 },
            { column: 1, row: 167, rowSpan: 28 },
        ]);
    });

    it('clamps a span wider than the grid to the column count', () => {
        const placed = packMasonry([{ height: 100, span: 3 }, { height: 100, span: 1 }], 2, 16, 2);
        expect(placed[0]).toEqual({ column: 1, row: 1, rowSpan: 58 });
        expect(placed[1]).toEqual({ column: 1, row: 59, rowSpan: 58 });
    });

    it('lets an empty cell take no slot and no height', () => {
        const placed = packMasonry([{ height: 0, span: 1 }, { height: 100, span: 1 }, { height: 100, span: 1 }], 2, 16, 2);
        expect(placed).toEqual([
            { column: 1, row: 1, rowSpan: 1 },
            { column: 1, row: 1, rowSpan: 58 },
            { column: 2, row: 1, rowSpan: 58 },
        ]);
    });
});
