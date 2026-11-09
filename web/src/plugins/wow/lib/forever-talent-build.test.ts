/**
 * ROK-2150: the Forever calculator build string — `<hashVersion><tree0>-<tree1>-<tree2>`,
 * one rank digit per talent in row-then-col order, trailing zeros / dashes trimmed.
 * `vkndmh--25` was checked in a browser: Protection Improved Bloodrage 2/2 + Shield Specialization 5/5.
 */
import { describe, it, expect } from 'vitest';
import fixture from './__fixtures__/forever-warrior-trees.json';
import { isForeverTalentTable, type ForeverClassTable, type JoinedForeverTalents } from './forever-talent-table';
import { foreverTalentBuildHash, getForeverTalentCalcUrl } from './forever-talent-build';
import { getWowheadTalentCalcUrl } from './wowhead-urls';

const BASE = 'https://www.wowhead.com/forever/talent-calc/warrior';

function warrior(): ForeverClassTable {
    if (!isForeverTalentTable(fixture) || !fixture.warrior) throw new Error('bad fixture');
    return fixture.warrior;
}

/** The warrior table joined with ranks keyed "<tree index>:<talent name>"; everything else 0. */
function joinedWith(ranks: Record<string, number>): JoinedForeverTalents {
    const trees = warrior().trees.map((tree, index) => {
        const talents = tree.talents.map((t) => ({ ...t, rank: ranks[`${index}:${t.name}`] ?? 0 }));
        return { name: tree.name, index, spent: talents.reduce((sum, t) => sum + t.rank, 0), talents };
    });
    return { trees, other: [] };
}

describe('foreverTalentBuildHash', () => {
    it('stamps the table hashVersion from the fixture (vkndmh)', () => {
        expect(warrior().hashVersion).toBe('vkndmh');
    });

    it('Protection-only Improved Bloodrage 2/2 + Shield Specialization 5/5 → vkndmh--25', () => {
        const joined = joinedWith({ '2:Improved Bloodrage': 2, '2:Shield Specialization': 5 });
        expect(foreverTalentBuildHash(joined, 'vkndmh')).toBe('vkndmh--25');
    });

    it('writes all three trees in calculator order, zeros kept inside a tree', () => {
        const joined = joinedWith({
            '0:Improved Heroic Strike': 3, '0:Improved Charge': 2, // Arms idx 0 and 3
            '1:Cruelty': 5, // Fury idx 1
            '2:Shield Specialization': 5, '2:Last Stand': 1, // Protection idx 1 and 6
        });
        expect(foreverTalentBuildHash(joined, 'vkndmh')).toBe('vkndmh3002-05-0500001');
    });

    it('keeps an empty middle tree as an empty segment and drops trailing empty trees', () => {
        expect(foreverTalentBuildHash(joinedWith({ '0:Deflection': 5 }), 'vkndmh')).toBe('vkndmh05');
        expect(foreverTalentBuildHash(joinedWith({ '0:Deflection': 5, '2:Iron Will': 1 }), 'vkndmh')).toBe('vkndmh05--001');
    });

    it('reads talents in row-then-col order even when the tree arrives shuffled', () => {
        const joined = joinedWith({ '2:Improved Bloodrage': 2, '2:Shield Specialization': 5 });
        const protection = joined.trees[2];
        if (!protection) throw new Error('no Protection tree');
        protection.talents.reverse();
        expect(foreverTalentBuildHash(joined, 'vkndmh')).toBe('vkndmh--25');
    });

    it('clamps a rank above maxRank to maxRank', () => {
        expect(foreverTalentBuildHash(joinedWith({ '2:Improved Bloodrage': 7 }), 'vkndmh')).toBe('vkndmh--2');
    });

    it('is null when no point is spent', () => {
        expect(foreverTalentBuildHash(joinedWith({}), 'vkndmh')).toBeNull();
    });
});

describe('getForeverTalentCalcUrl', () => {
    it('links the build when the joined talents and hashVersion are known', () => {
        const joined = joinedWith({ '2:Improved Bloodrage': 2, '2:Shield Specialization': 5 });
        expect(getForeverTalentCalcUrl('Warrior', joined, 'vkndmh')).toBe(`${BASE}/vkndmh--25`);
    });

    it('falls back to the bare calculator with no points, no join yet, or no hashVersion', () => {
        const joined = joinedWith({ '2:Improved Bloodrage': 2 });
        expect(getForeverTalentCalcUrl('Warrior', joinedWith({}), 'vkndmh')).toBe(BASE);
        expect(getForeverTalentCalcUrl('Warrior', null, 'vkndmh')).toBe(BASE);
        expect(getForeverTalentCalcUrl('Warrior', joined, null)).toBe(BASE);
    });

    it('is null for a class Wowhead has no calculator slug for', () => {
        expect(getForeverTalentCalcUrl('Bard', joinedWith({}), 'vkndmh')).toBeNull();
    });
});

describe('getWowheadTalentCalcUrl build segment', () => {
    it('appends a build and ignores an empty/null one', () => {
        expect(getWowheadTalentCalcUrl('Warrior', 'wow_forever', 'vkndmh--25')).toBe(`${BASE}/vkndmh--25`);
        expect(getWowheadTalentCalcUrl('Warrior', 'wow_forever', '')).toBe(BASE);
        expect(getWowheadTalentCalcUrl('Warrior', 'wow_forever', null)).toBe(BASE);
    });
});
