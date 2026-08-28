import { describe, it, expect } from 'vitest';
import type { GameTimeSlot } from '@raid-ledger/contract';
import {
    deriveBlocks, deriveAllBlocks, findBlockAt, setBlockRange,
    lockedIndices, maxEndIndex, minStartIndex, moveBlock,
} from './slot-blocks.utils';

/** Full day, matching the grid's default [0, 24] range. */
const FULL = Array.from({ length: 24 }, (_, i) => i);
/** Wrapping evening range [19, 2] -> 19,20,21,22,23,0,1 — the profile default shape. */
const WRAP = [19, 20, 21, 22, 23, 0, 1];

const avail = (day: number, hours: number[]): GameTimeSlot[] =>
    hours.map((h) => ({ dayOfWeek: day, hour: h, status: 'available' as const }));
const hoursOf = (slots: GameTimeSlot[], day: number): number[] =>
    slots.filter((s) => s.dayOfWeek === day).map((s) => s.hour).sort((a, b) => a - b);

describe('deriveBlocks', () => {
    it('returns nothing for a day with no slots', () => {
        expect(deriveBlocks([], 2, FULL)).toEqual([]);
    });

    it('collapses contiguous hours into one block with an exclusive end', () => {
        expect(deriveBlocks(avail(2, [19, 20, 21]), 2, FULL)).toEqual([
            { dayOfWeek: 2, startIndex: 19, endIndex: 22 },
        ]);
    });

    it('splits non-contiguous hours into separate blocks', () => {
        expect(deriveBlocks(avail(2, [9, 10, 14]), 2, FULL)).toEqual([
            { dayOfWeek: 2, startIndex: 9, endIndex: 11 },
            { dayOfWeek: 2, startIndex: 14, endIndex: 15 },
        ]);
    });

    it('ignores other days', () => {
        const slots = [...avail(1, [8]), ...avail(2, [9])];
        expect(deriveBlocks(slots, 2, FULL)).toEqual([{ dayOfWeek: 2, startIndex: 9, endIndex: 10 }]);
    });

    it('treats a slot with no status as available, matching isSlotActive', () => {
        const slots = [{ dayOfWeek: 0, hour: 5 }] as GameTimeSlot[];
        expect(deriveBlocks(slots, 0, FULL)).toEqual([{ dayOfWeek: 0, startIndex: 5, endIndex: 6 }]);
    });

    it('breaks a run at a blocked hour rather than spanning it', () => {
        const slots: GameTimeSlot[] = [
            ...avail(3, [9, 10]),
            { dayOfWeek: 3, hour: 11, status: 'blocked' },
            ...avail(3, [12]),
        ];
        expect(deriveBlocks(slots, 3, FULL)).toEqual([
            { dayOfWeek: 3, startIndex: 9, endIndex: 11 },
            { dayOfWeek: 3, startIndex: 12, endIndex: 13 },
        ]);
    });

    it('indexes against the visible range, not the raw hour, when the range wraps', () => {
        // 23 and 0 are adjacent ON SCREEN in a [19, 2] range, so they are one block.
        expect(deriveBlocks(avail(5, [23, 0]), 5, WRAP)).toEqual([
            { dayOfWeek: 5, startIndex: 4, endIndex: 6 },
        ]);
    });

    it('omits hours that fall outside the visible range', () => {
        expect(deriveBlocks(avail(5, [10, 20]), 5, WRAP)).toEqual([
            { dayOfWeek: 5, startIndex: 1, endIndex: 2 },
        ]);
    });
});

describe('deriveAllBlocks', () => {
    it('walks every day', () => {
        const slots = [...avail(0, [1]), ...avail(6, [22, 23])];
        expect(deriveAllBlocks(slots, FULL)).toEqual([
            { dayOfWeek: 0, startIndex: 1, endIndex: 2 },
            { dayOfWeek: 6, startIndex: 22, endIndex: 24 },
        ]);
    });
});

describe('findBlockAt', () => {
    const slots = avail(4, [20, 21, 22]);

    it('finds the block covering an interior index', () => {
        expect(findBlockAt(slots, 4, 21, FULL)).toEqual({ dayOfWeek: 4, startIndex: 20, endIndex: 23 });
    });

    it('treats the exclusive end as outside the block', () => {
        expect(findBlockAt(slots, 4, 23, FULL)).toBeNull();
    });

    it('returns null when the index is empty', () => {
        expect(findBlockAt(slots, 4, 8, FULL)).toBeNull();
    });
});

describe('setBlockRange', () => {
    it('adds available slots across the range', () => {
        const result = setBlockRange([], 1, 19, 22, true, FULL);
        expect(hoursOf(result, 1)).toEqual([19, 20, 21]);
        expect(result.every((s) => s.status === 'available')).toBe(true);
    });

    it('clears only the targeted range', () => {
        const result = setBlockRange(avail(1, [19, 20, 21]), 1, 20, 21, false, FULL);
        expect(hoursOf(result, 1)).toEqual([19, 21]);
    });

    it('does not duplicate an hour that is already available', () => {
        const result = setBlockRange(avail(1, [19]), 1, 19, 21, true, FULL);
        expect(hoursOf(result, 1)).toEqual([19, 20]);
    });

    it('never overwrites a blocked hour inside the range', () => {
        const slots: GameTimeSlot[] = [{ dayOfWeek: 1, hour: 20, status: 'blocked' }];
        const result = setBlockRange(slots, 1, 19, 22, true, FULL);
        expect(result.find((s) => s.hour === 20)?.status).toBe('blocked');
        expect(hoursOf(result, 1)).toEqual([19, 20, 21]);
        // The blocked hour splits the result rather than joining it.
        expect(deriveBlocks(result, 1, FULL)).toEqual([
            { dayOfWeek: 1, startIndex: 19, endIndex: 20 },
            { dayOfWeek: 1, startIndex: 21, endIndex: 22 },
        ]);
    });

    it('leaves a committed hour alone when clearing', () => {
        const slots: GameTimeSlot[] = [{ dayOfWeek: 1, hour: 20, status: 'committed' }, ...avail(1, [21])];
        const result = setBlockRange(slots, 1, 20, 22, false, FULL);
        expect(hoursOf(result, 1)).toEqual([20]);
        expect(result[0].status).toBe('committed');
    });

    it('clamps a range that runs past the end of the visible hours', () => {
        const result = setBlockRange([], 0, 5, 99, true, WRAP);
        expect(hoursOf(result, 0)).toEqual([0, 1]);
    });

    it('returns the original array when the range is empty', () => {
        const slots = avail(1, [9]);
        expect(setBlockRange(slots, 1, 3, 3, true, FULL)).toBe(slots);
    });

    it('maps indices through a wrapping range', () => {
        const result = setBlockRange([], 5, 4, 6, true, WRAP);
        expect(hoursOf(result, 5)).toEqual([0, 23]);
    });
});

describe('lockedIndices', () => {
    it('reports blocked and committed hours as index positions', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 2, hour: 23, status: 'blocked' },
            { dayOfWeek: 2, hour: 0, status: 'committed' },
            ...avail(2, [19]),
        ];
        expect([...lockedIndices(slots, 2, WRAP)].sort()).toEqual([4, 5]);
    });
});

describe('maxEndIndex / minStartIndex', () => {
    const slots: GameTimeSlot[] = [{ dayOfWeek: 0, hour: 12, status: 'blocked' }];

    it('stops the end at the first locked hour above the start', () => {
        expect(maxEndIndex(slots, 0, 9, FULL)).toBe(12);
    });

    it('runs to the end of the range when nothing is locked', () => {
        expect(maxEndIndex([], 0, 9, FULL)).toBe(24);
    });

    it('stops the start just past the nearest locked hour below the end', () => {
        expect(minStartIndex(slots, 0, 16, FULL)).toBe(13);
    });

    it('runs to zero when nothing is locked', () => {
        expect(minStartIndex([], 0, 16, FULL)).toBe(0);
    });
});

describe('moveBlock', () => {
    const block = { dayOfWeek: 2, startIndex: 19, endIndex: 22 };

    it('shifts the block and keeps its length', () => {
        const result = moveBlock(avail(2, [19, 20, 21]), block, 21, FULL);
        expect(hoursOf(result, 2)).toEqual([21, 22, 23]);
    });

    it('clamps at the end of the visible range instead of truncating', () => {
        const result = moveBlock(avail(2, [19, 20, 21]), block, 40, FULL);
        expect(hoursOf(result, 2)).toEqual([21, 22, 23]);
    });

    it('clamps at zero', () => {
        const result = moveBlock(avail(2, [19, 20, 21]), block, -5, FULL);
        expect(hoursOf(result, 2)).toEqual([0, 1, 2]);
    });

    it('refuses a destination that would cross a locked hour, leaving slots untouched', () => {
        const slots: GameTimeSlot[] = [...avail(2, [19, 20, 21]), { dayOfWeek: 2, hour: 23, status: 'blocked' }];
        const result = moveBlock(slots, block, 21, FULL);
        expect(result).toBe(slots);
    });

    it('is a no-op when the block does not move', () => {
        const slots = avail(2, [19, 20, 21]);
        expect(moveBlock(slots, block, 19, FULL)).toBe(slots);
    });

    it('merges into a neighbour it lands against', () => {
        const slots = [...avail(2, [19, 20]), ...avail(2, [23])];
        const result = moveBlock(slots, { dayOfWeek: 2, startIndex: 19, endIndex: 21 }, 21, FULL);
        expect(hoursOf(result, 2)).toEqual([21, 22, 23]);
        expect(deriveBlocks(result, 2, FULL)).toEqual([{ dayOfWeek: 2, startIndex: 21, endIndex: 24 }]);
    });
});
