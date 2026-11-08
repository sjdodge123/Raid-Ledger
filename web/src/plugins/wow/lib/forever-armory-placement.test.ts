/**
 * ROK-2110 AC7 (D5/F1/F3): Blizzard-sourced Forever talents without grid
 * positions are placed on the known trees by talent-name slug.
 */
import { describe, it, expect } from 'vitest';
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import { armoryTreeNames, placeArmoryTalents } from './forever-armory-placement';

function armory(nodes: ForeverTalentNodeDto[], names?: string[]): ForeverTalentsDto {
    const trees = [0, 1, 2].map((index) => {
        const name = names?.[index];
        return { index, spent: nodes.filter((n) => n.tree === index).reduce((s, n) => s + n.rank, 0), ...(name !== undefined ? { name } : {}) };
    });
    return { format: 'forever', source: 'blizzard', syncedAt: '2026-11-06T09:00:00.000Z', layout: 'list', trees, nodes };
}

const ARMS_FURY: ForeverTalentNodeDto[] = [
    { nodeId: 10, rank: 3, name: 'Improved Heroic Strike', tree: 0 },
    { nodeId: 11, rank: 1, name: 'Mortal Strike', tree: 0 },
    { nodeId: 12, rank: 5, name: 'Cruelty', tree: 1 },
];

function byId(dto: ForeverTalentsDto, id: number): ForeverTalentNodeDto | undefined {
    return dto.nodes.find((n) => n.nodeId === id);
}

describe('placeArmoryTalents — placed', () => {
    it('turns a list payload into a grid when every ranked talent is on a known tree', () => {
        const out = placeArmoryTalents(armory(ARMS_FURY), 'Warrior');
        expect(out.layout).toBe('grid');
        expect(byId(out, 10)).toMatchObject({ tree: 0, row: 0, col: 0 });
        expect(byId(out, 11)).toMatchObject({ tree: 0, row: 6, col: 1 });
        expect(byId(out, 12)).toMatchObject({ tree: 1, row: 0, col: 2 });
    });

    it('matches the class case-insensitively and drops rank-0 nodes from the grid', () => {
        const nodes = [...ARMS_FURY, { nodeId: 13, rank: 0, name: 'Not A Talent', tree: 2 }];
        const out = placeArmoryTalents(armory(nodes), 'warrior');
        expect(out.layout).toBe('grid');
        expect(out.nodes.map((n) => n.nodeId)).toEqual([10, 11, 12]);
    });

    it('resolves the druid "Feral" header to the "Feral Combat" known tree', () => {
        const out = placeArmoryTalents(armory([{ nodeId: 20, rank: 5, name: 'Ferocity', tree: 1 }]), 'Druid');
        expect(out.layout).toBe('grid');
        expect(byId(out, 20)).toMatchObject({ row: 0, col: 1 });
    });
});

function positioned(n: ForeverTalentNodeDto | undefined): boolean {
    return n?.row !== undefined && n.col !== undefined;
}

describe('placeArmoryTalents — per-talent fallback (ROK-2113)', () => {
    it('places the known talents and keeps an unknown one unpositioned under its tree', () => {
        const out = placeArmoryTalents(armory([...ARMS_FURY, { nodeId: 14, rank: 2, name: 'Master of Defense', tree: 2 }]), 'Warrior');
        expect(out.layout).toBe('grid');
        expect(byId(out, 10)).toMatchObject({ tree: 0, row: 0, col: 0, rank: 3 });
        expect(byId(out, 14)).toEqual({ nodeId: 14, rank: 2, name: 'Master of Defense', tree: 2 });
    });

    it('keeps the tree totals untouched on a partial grid', () => {
        const input = armory([...ARMS_FURY, { nodeId: 14, rank: 2, name: 'Master of Defense', tree: 2 }]);
        expect(placeArmoryTalents(input, 'Warrior').trees).toEqual(input.trees);
    });

    it('keeps an unnamed ranked node unpositioned beside a placed grid', () => {
        const out = placeArmoryTalents(armory([...ARMS_FURY, { nodeId: 15, rank: 1, tree: 0 }]), 'Warrior');
        expect(out.layout).toBe('grid');
        expect(positioned(byId(out, 15))).toBe(false);
        expect(positioned(byId(out, 11))).toBe(true);
    });

    it('keeps the list when NO ranked talent places, an unknown class, or no class', () => {
        const unknown = armory([{ nodeId: 14, rank: 2, name: 'Master of Defense', tree: 2 }]);
        expect(placeArmoryTalents(unknown, 'Warrior')).toBe(unknown);
        expect(placeArmoryTalents(armory(ARMS_FURY), 'Monk').layout).toBe('list');
        expect(placeArmoryTalents(armory(ARMS_FURY), null).layout).toBe('list');
    });

    it('never touches addon payloads or Blizzard payloads already in grid layout', () => {
        const addon: ForeverTalentsDto = { ...armory(ARMS_FURY), source: 'addon' };
        expect(placeArmoryTalents(addon, 'Warrior')).toBe(addon);
        const grid: ForeverTalentsDto = { ...armory(ARMS_FURY), layout: 'grid' };
        expect(placeArmoryTalents(grid, 'Warrior')).toBe(grid);
    });
});

describe('placeArmoryTalents — TBC table guards (review MAJOR)', () => {
    it('keeps the list when the only ranked talent sits past vanilla row 6 (TBC rows h/i)', () => {
        // "Wrath of Cenarius" is 'h2' in the TBC table: row 7, which no vanilla/Forever tree has.
        const input = armory([{ nodeId: 30, rank: 5, name: 'Wrath of Cenarius', tree: 0 }], ['Balance', 'Feral', 'Restoration']);
        expect(placeArmoryTalents(input, 'Druid')).toBe(input);
    });

    it('unpositions BOTH talents that land on the same cell; the rest still place', () => {
        const out = placeArmoryTalents(armory([...ARMS_FURY, { nodeId: 16, rank: 2, name: 'Improved Heroic Strike', tree: 0 }]), 'Warrior');
        expect(out.layout).toBe('grid');
        expect([10, 16].map((id) => positioned(byId(out, id)))).toEqual([false, false]);
        expect([11, 12].map((id) => positioned(byId(out, id)))).toEqual([true, true]);
    });

    it('a past-row-6 talent stays unpositioned while a known one places', () => {
        // Ferocity ('a2') places; Force of Nature ('i2', row 8) is listed, never put on a wrong cell.
        const out = placeArmoryTalents(armory([
            { nodeId: 20, rank: 5, name: 'Ferocity', tree: 1 },
            { nodeId: 31, rank: 1, name: 'Force of Nature', tree: 0 },
        ], ['Balance', 'Feral', 'Restoration']), 'Druid');
        expect(out.layout).toBe('grid');
        expect(byId(out, 20)).toMatchObject({ row: 0, col: 1 });
        expect(byId(out, 31)).toEqual({ nodeId: 31, rank: 1, name: 'Force of Nature', tree: 0 });
    });
});

describe('tree order from trees[].name (F3)', () => {
    it('uses Blizzard tree names to pick the known tree for each index', () => {
        // Blizzard sent Fury first: index 0 is "Fury", so Cruelty under tree 0 places.
        const out = placeArmoryTalents(armory([{ nodeId: 12, rank: 5, name: 'Cruelty', tree: 0 }], ['Fury', 'Arms', 'Protection']), 'Warrior');
        expect(out.layout).toBe('grid');
        expect(byId(out, 12)).toMatchObject({ tree: 0, row: 0, col: 2 });
    });

    it('falls back to the class table, then "Tree N", when names are missing', () => {
        expect(armoryTreeNames(armory([], ['Fury']), 'Warrior')).toEqual(['Fury', 'Fury', 'Protection']);
        expect(armoryTreeNames(armory([]), 'Warrior')).toEqual(['Arms', 'Fury', 'Protection']);
        expect(armoryTreeNames(armory([]), null)).toEqual(['Tree 1', 'Tree 2', 'Tree 3']);
    });
});
