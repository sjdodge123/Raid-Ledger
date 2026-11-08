import { describe, expect, it } from 'vitest';
import trees from './forever-trees.json';

const CLASSES = [
    'warrior',
    'paladin',
    'hunter',
    'rogue',
    'priest',
    'shaman',
    'mage',
    'warlock',
    'druid',
] as const;

type Table = Record<
    string,
    {
        trees: {
            name: string;
            talents: {
                spellId: number;
                row: number;
                col: number;
                prereqSpellId: number | null;
            }[];
        }[];
    }
>;
const table = trees as Table;

describe.each(CLASSES)('forever-trees.json: %s', (slug) => {
    const entry = table[slug];

    it('has 3 trees with at least 14 talents each', () => {
        expect(entry?.trees).toHaveLength(3);
        for (const tree of entry?.trees ?? []) {
            expect(tree.talents.length).toBeGreaterThanOrEqual(14);
        }
    });

    it('keeps every talent in rows 0-6, cols 0-3, one per cell, with a real spell id', () => {
        for (const tree of entry?.trees ?? []) {
            const cells = new Set<string>();
            for (const t of tree.talents) {
                expect(t.row).toBeGreaterThanOrEqual(0);
                expect(t.row).toBeLessThanOrEqual(6);
                expect(t.col).toBeGreaterThanOrEqual(0);
                expect(t.col).toBeLessThanOrEqual(3);
                expect(t.spellId).toBeGreaterThan(0);
                cells.add(`${t.row},${t.col}`);
            }
            expect(cells.size).toBe(tree.talents.length);
        }
    });

    it('points every prerequisite at a talent in the same tree', () => {
        for (const tree of entry?.trees ?? []) {
            const ids = new Set(tree.talents.map((t) => t.spellId));
            for (const t of tree.talents) {
                if (t.prereqSpellId !== null)
                    expect(ids.has(t.prereqSpellId)).toBe(true);
            }
        }
    });
});
