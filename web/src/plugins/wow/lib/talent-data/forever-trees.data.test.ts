import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/forever-warrior-trees.json';
import { isForeverTalentTable, type ForeverTalentTable } from '../forever-talent-table';

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

/** Every `forever/<class>.json`, keyed by class slug (the file name) — the files the loader globs. */
const FILES = import.meta.glob<unknown>('./forever/*.json', { eager: true, import: 'default' });
const trees = Object.fromEntries(Object.entries(FILES).map(([file, json]) => [file.replace(/^\.\/forever\/|\.json$/g, ''), json]));

/** The JSON through the same shape guard the loader uses — no cast. */
function loadTable(): ForeverTalentTable {
    if (!isForeverTalentTable(trees)) throw new Error('forever/<class>.json fails isForeverTalentTable');
    return trees;
}
const table = loadTable();

it('has exactly one file per Forever class (ROK-2150 per-class split)', () => {
    expect(Object.keys(table).sort()).toEqual([...CLASSES].sort());
});

it('the warrior spec fixture is a copy of the real warrior table (no drift)', () => {
    expect(isForeverTalentTable(fixture) ? fixture.warrior : null).toEqual(table.warrior);
});

describe.each(CLASSES)('forever/%s.json', (slug) => {
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

    it('draws every prerequisite as a straight arrow: down its column, or along its row (review MINOR-7)', () => {
        for (const tree of entry?.trees ?? []) {
            for (const t of tree.talents) {
                const from = tree.talents.find((p) => p.spellId === t.prereqSpellId);
                if (!from) continue;
                const drawable = (from.col === t.col && t.row > from.row) || (from.row === t.row && from.col !== t.col);
                expect(drawable, `${t.name} ← ${from.name} (${from.row},${from.col} → ${t.row},${t.col})`).toBe(true);
            }
        }
    });

    it('carries the calculator hashVersion and one plain-text description per rank (ROK-2150)', () => {
        expect(entry?.hashVersion).toMatch(/^[a-z0-9]+$/);
        for (const tree of entry?.trees ?? []) {
            for (const t of tree.talents) {
                expect(t.descriptions, t.name).toHaveLength(t.maxRank);
                for (const text of t.descriptions) {
                    expect(text, `${t.name} is plain text`).not.toMatch(/<[^>]*>|&[a-z#0-9]+;|<!--/i);
                    expect(text.trim(), `${t.name} has text`).not.toBe('');
                }
            }
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
