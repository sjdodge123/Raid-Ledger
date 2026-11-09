/**
 * ROK-2146: the static Forever talent table — the join of `ForeverTalentsDto.nodes`
 * onto it (spellId first, then normalised name within the tree) and the default tree.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import fixture from './__fixtures__/forever-warrior-trees.json';
import { isForeverTalentTable, joinForeverTalents, mostPointsTreeIndex, type ForeverClassTable } from './forever-talent-table';

function warrior(): ForeverClassTable {
    if (!isForeverTalentTable(fixture)) throw new Error('fixture is not a talent table');
    const table = fixture.warrior;
    if (!table) throw new Error('fixture has no warrior');
    return table;
}

function dto(nodes: ForeverTalentNodeDto[], trees: ForeverTalentsDto['trees'] = []): ForeverTalentsDto {
    return { format: 'forever', source: 'blizzard', syncedAt: '2026-11-08T12:00:00.000Z', layout: 'list', trees, nodes };
}

function rankOf(joined: ReturnType<typeof joinForeverTalents>, tree: number, name: string): number | undefined {
    return joined.trees[tree]?.talents.find((t) => t.name === name)?.rank;
}

describe('joinForeverTalents', () => {
    it('places every table talent, unspent ones at rank 0', () => {
        const joined = joinForeverTalents(dto([]), warrior());
        expect(joined.trees.map((t) => [t.name, t.talents.length])).toEqual([['Arms', 17], ['Fury', 18], ['Protection', 18]]);
        expect(rankOf(joined, 2, 'Shield Specialization')).toBe(0);
    });

    it('matches a node by spellId even with no name and no tree', () => {
        const joined = joinForeverTalents(dto([{ nodeId: 1, rank: 5, spellId: 12298 }]), warrior());
        expect(rankOf(joined, 2, 'Shield Specialization')).toBe(5);
        expect(joined.other).toEqual([]);
    });

    it('falls back to the normalised name within the same tree (a rank-2 spell id)', () => {
        const joined = joinForeverTalents(dto([{ nodeId: 2, rank: 2, spellId: 99999, name: 'improved  bloodrage', tree: 2 }]), warrior());
        expect(rankOf(joined, 2, 'Improved Bloodrage')).toBe(2);
    });

    it('does not name-match across trees', () => {
        const joined = joinForeverTalents(dto([{ nodeId: 3, rank: 1, name: 'Mortal Strike', tree: 2 }]), warrior());
        expect(rankOf(joined, 0, 'Mortal Strike')).toBe(0);
        expect(joined.other.map((n) => n.nodeId)).toEqual([3]);
    });

    it('lists an unmatched ranked node under other, never an unranked one', () => {
        const joined = joinForeverTalents(dto([{ nodeId: 4, rank: 2, name: 'Mystery' }, { nodeId: 5, rank: 0, name: 'Ghost' }]), warrior());
        expect(joined.other.map((n) => n.nodeId)).toEqual([4]);
    });

    it('takes tree points from the DTO trees, else sums the matched ranks', () => {
        const nodes = [{ nodeId: 1, rank: 5, spellId: 12298 }, { nodeId: 2, rank: 1, spellId: 12975 }];
        expect(joinForeverTalents(dto(nodes), warrior()).trees.map((t) => t.spent)).toEqual([0, 0, 6]);
        expect(joinForeverTalents(dto(nodes, [{ index: 2, spent: 13 }]), warrior()).trees[2]?.spent).toBe(13);
    });
});

describe('mostPointsTreeIndex', () => {
    it('picks the tree with the most points, the first on a tie or none', () => {
        expect(mostPointsTreeIndex([{ spent: 0 }, { spent: 3 }, { spent: 13 }])).toBe(2);
        expect(mostPointsTreeIndex([{ spent: 4 }, { spent: 4 }, { spent: 0 }])).toBe(0);
        expect(mostPointsTreeIndex([{ spent: 0 }, { spent: 0 }, { spent: 0 }])).toBe(0);
    });
});

describe('isForeverTalentTable', () => {
    it('rejects a malformed table', () => {
        expect(isForeverTalentTable({ warrior: { trees: [{ name: 'Arms', talents: [{ spellId: 'x' }] }] } })).toBe(false);
        expect(isForeverTalentTable(null)).toBe(false);
    });

    it('rejects a table without hashVersion, or a talent with too few or HTML descriptions (ROK-2150)', () => {
        expect(isForeverTalentTable({ warrior: { trees: warrior().trees } })).toBe(false);
        const withDescriptions = (descriptions: string[]) => ({
            hashVersion: 'vkndmh',
            trees: [{ name: 'Arms', talents: [{ spellId: 1, name: 'X', row: 0, col: 0, maxRank: 2, icon: 'i', prereqSpellId: null, descriptions }] }],
        });
        expect(isForeverTalentTable({ warrior: withDescriptions(['a', 'b']) })).toBe(true);
        expect(isForeverTalentTable({ warrior: withDescriptions(['a']) })).toBe(false);
        expect(isForeverTalentTable({ warrior: withDescriptions(['a', 'b<br />c']) })).toBe(false);
    });
});

describe('loadForeverClassTable (the real lazy table)', () => {
    it('resolves a three-tree table for every Forever class, null for an unknown one', async () => {
        const { loadForeverClassTable } = await import('./forever-talent-table');
        for (const cls of ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock', 'Druid']) {
            expect((await loadForeverClassTable(cls))?.trees.length, cls).toBe(3);
        }
        expect(await loadForeverClassTable('Monk')).toBeNull();
        expect(await loadForeverClassTable(null)).toBeNull();
    });
});

describe('peekForeverClassTable (review MINOR-2: loading vs missing)', () => {
    it('is undefined until the table settles, then the class trees, null for an unknown class or none', async () => {
        vi.resetModules();
        const mod = await import('./forever-talent-table');
        expect(mod.peekForeverClassTable('Warrior'), 'not loaded yet = loading').toBeUndefined();
        expect(mod.peekForeverClassTable(null), 'no class is known missing at once').toBeNull();
        await mod.loadForeverClassTable('Warrior');
        expect(mod.peekForeverClassTable('Warrior')?.trees.length, 'settled = ready without waiting').toBe(3);
        expect(mod.peekForeverClassTable('Monk'), 'class absent = missing').toBeNull();
    });
});
