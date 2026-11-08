/**
 * ROK-2113 T1 (delta review): Blizzard trees move to their class column by
 * name; an unnamed tree keeps its own column when that column is free.
 */
import { describe, it, expect } from 'vitest';
import type { ForeverTalentsDto } from '@raid-ledger/contract';
import { alignArmoryTrees } from './forever-armory-tree-align';

function payload(trees: ForeverTalentsDto['trees']): ForeverTalentsDto {
    return { format: 'forever', source: 'blizzard', syncedAt: '2026-11-08T09:00:00.000Z', layout: 'list', trees, nodes: [] };
}

describe('alignArmoryTrees — unnamed trees (review NIT)', () => {
    it('keeps an unnamed tree in its own column when that column is free', () => {
        const out = alignArmoryTrees(payload([{ index: 0, spent: 5, name: 'Protection' }, { index: 1, spent: 3 }]), 'Warrior');
        expect(out.trees.map((t) => [t.index, t.spent]), 'the unnamed tree 1 must stay in column 1, not jump to column 0').toEqual([[1, 3], [2, 5]]);
    });

    it('moves an unnamed tree to the first free column when its own is taken', () => {
        const out = alignArmoryTrees(payload([{ index: 0, spent: 4 }, { index: 1, spent: 3, name: 'Arms' }]), 'Warrior');
        expect(out.trees.map((t) => [t.index, t.spent])).toEqual([[0, 3], [1, 4]]);
    });
});
