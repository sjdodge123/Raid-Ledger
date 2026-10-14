import { describe, it, expect } from 'vitest';
import { placeTip } from './layer-tip-placement';

/** A 16px glyph whose left edge is at `left`. */
const glyph = (left: number) => ({ anchorLeft: left, anchorRight: left + 16 });

describe('placeTip (AC8)', () => {
    it('opens right at full width for a glyph near the left edge', () => {
        expect(placeTip({ ...glyph(60), boundaryLeft: 0, boundaryRight: 1280 })).toEqual({ side: 'right', maxWidth: 256 });
    });

    it('opens left at full width for a glyph near the right edge', () => {
        expect(placeTip({ ...glyph(1200), boundaryLeft: 0, boundaryRight: 1280 })).toEqual({ side: 'left', maxWidth: 256 });
    });

    it('keeps the right side when the full tip fits exactly', () => {
        expect(placeTip({ ...glyph(720), boundaryLeft: 0, boundaryRight: 1000 })).toEqual({ side: 'right', maxWidth: 256 });
        expect(placeTip({ ...glyph(721), boundaryLeft: 0, boundaryRight: 1000 }).side).toBe('left');
    });

    it('a middle glyph in a 375px Week grid opens toward the larger room and is capped to it', () => {
        // Wed column: 375 - 166 - 8 = 201px right vs 150 - 8 = 142px left.
        expect(placeTip({ ...glyph(150), boundaryLeft: 0, boundaryRight: 375 })).toEqual({ side: 'right', maxWidth: 201 });
        // Fri column: 375 - 256 - 8 = 111px right vs 240 - 8 = 232px left.
        expect(placeTip({ ...glyph(240), boundaryLeft: 0, boundaryRight: 375 })).toEqual({ side: 'left', maxWidth: 232 });
    });

    it('never lets a tip pass either edge of a narrow viewport, for every Week column at 375px', () => {
        for (let left = 48; left <= 359; left += 1) {
            const { side, maxWidth } = placeTip({ ...glyph(left), boundaryLeft: 0, boundaryRight: 375 });
            const [tipLeft, tipRight] = side === 'right' ? [left + 16 + 4, left + 16 + 4 + maxWidth] : [left - 4 - maxWidth, left - 4];
            expect({ left, tipLeft: tipLeft >= 0, tipRight: tipRight <= 375 }).toEqual({ left, tipLeft: true, tipRight: true });
        }
    });

    it('respects a grid whose left edge is inside the viewport', () => {
        expect(placeTip({ ...glyph(300), boundaryLeft: 200, boundaryRight: 400 })).toEqual({ side: 'left', maxWidth: 92 });
    });
});
