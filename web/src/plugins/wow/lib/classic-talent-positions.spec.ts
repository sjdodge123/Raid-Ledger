import { describe, it, expect } from 'vitest';
import {
    CLASSIC_TALENT_POSITIONS,
    buildWowheadTalentString,
} from './classic-talent-positions';

// ---------------------------------------------------------------------------
// Helpers — import indirectly-tested internal functions via the module's
// public API. nameToSlug is not exported, so we test it through
// buildWowheadTalentString's slug matching behaviour.
// ---------------------------------------------------------------------------

/**
 * Exercise nameToSlug indirectly: build a single-talent tree where the only
 * way the output is non-zero is if the slug was matched correctly.
 */
function assertSlugMatchesTalent(
    className: string,
    treeName: string,
    apiTalentName: string,
): void {
    const classMap = CLASSIC_TALENT_POSITIONS[className];
    const treeMap = classMap[treeName];
    const treeOrder = Object.keys(classMap);

    // Build trees array in the correct order with only this one talent
    const trees = treeOrder.map((name) => ({
        name,
        spentPoints: name === treeName ? 1 : 0,
        talents: name === treeName
            ? [{ name: apiTalentName, rank: 1 }]
            : [],
    }));

    const result = buildWowheadTalentString(className, trees);
    expect(result).not.toBeNull();

    // The result should contain at least one non-zero digit
    const allDigits = result!.replace(/-/g, '');
    const nonZero = allDigits.replace(/0/g, '');
    expect(nonZero.length).toBeGreaterThan(0);

    // Find the expected position index within this tree's sorted talents
    const slug = apiTalentName
        .toLowerCase()
        .replace(/[':]/g, '')
        .replace(/[()]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    expect(treeMap[slug]).toBeDefined();
}

// ---------------------------------------------------------------------------
// nameToSlug — tested via slug matching through buildWowheadTalentString
// ---------------------------------------------------------------------------

describe('nameToSlug (via buildWowheadTalentString slug matching)', () => {
    it('normalizes apostrophes: "Nature\'s Grasp" → "natures-grasp"', () => {
        assertSlugMatchesTalent('Druid', 'Balance', "Nature's Grasp");
    });

    it('normalizes parentheses: "Faerie Fire (Feral)" → "faerie-fire-feral"', () => {
        assertSlugMatchesTalent('Druid', 'Feral Combat', 'Faerie Fire (Feral)');
    });

    it('normalizes colons: "Improved Power Word: Shield" → "improved-power-word-shield"', () => {
        assertSlugMatchesTalent('Priest', 'Discipline', 'Improved Power Word: Shield');
    });

    it('normalizes simple names: "Ferocity" → "ferocity"', () => {
        assertSlugMatchesTalent('Druid', 'Feral Combat', 'Ferocity');
    });

    it('normalizes multi-word names: "Heart of the Wild" → "heart-of-the-wild"', () => {
        assertSlugMatchesTalent('Druid', 'Feral Combat', 'Heart of the Wild');
    });
});

// ---------------------------------------------------------------------------
// buildWowheadTalentString — full class talent string build (Druid)
// ---------------------------------------------------------------------------

describe('buildWowheadTalentString', () => {
    describe('full Druid talent string build', () => {
        it('produces correct Wowhead talent string for a Balance/Resto Druid', () => {
            // Build a Druid with points in Balance and Restoration, none in Feral.
            // Balance tree (21 talents sorted by position):
            //   a1:starlight-wrath(5), a2:natures-grasp(1), a3:improved-natures-grasp(0)
            //   b1:control-of-nature(0), b2:focused-starlight(0), b3:improved-moonfire(5)
            //   c1:brambles(0), c3:insect-swarm(1), c4:natures-reach(0)
            //   d2:vengeance(5), d3:celestial-focus(0)
            //   e1:lunar-guidance(0), e2:natures-grace(1), e3:moonglow(3)
            //   f2:moonfury(5), f3:balance-of-power(0)
            //   g1:dreamstate(0), g2:moonkin-form(1), g3:improved-faerie-fire(0)
            //   h2:wrath-of-cenarius(0)
            //   i2:force-of-nature(0)
            // String: "5" "1" "0" "0" "0" "5" "0" "1" "0" "5" "0" "0" "1" "3" "5" "0" "0" "1"
            //       = "510005010500135001" (trailing zeros trimmed)

            const trees = [
                {
                    name: 'Balance',
                    spentPoints: 32,
                    talents: [
                        { name: 'Starlight Wrath', rank: 5 },
                        { name: "Nature's Grasp", rank: 1 },
                        { name: 'Improved Moonfire', rank: 5 },
                        { name: 'Insect Swarm', rank: 1 },
                        { name: 'Vengeance', rank: 5 },
                        { name: "Nature's Grace", rank: 1 },
                        { name: 'Moonglow', rank: 3 },
                        { name: 'Moonfury', rank: 5 },
                        { name: 'Moonkin Form', rank: 1 },
                    ],
                },
                {
                    name: 'Feral Combat',
                    spentPoints: 0,
                    talents: [],
                },
                {
                    name: 'Restoration',
                    spentPoints: 5,
                    talents: [
                        { name: 'Furor', rank: 5 },
                    ],
                },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            // Balance: positions sorted → digits for each of 21 talents
            // 5,1,0,0,0,5,0,1,0,5,0,0,1,3,5,0,0,1,0,0,0 → "510005010500135001"
            // Feral: 0 (empty)
            // Restoration: furor is at a3 (3rd position): 0,5 → "05"
            // Trailing tree trimming: Restoration is non-zero, so all 3 trees present
            expect(result).toBe('510005010500135001-0-05');
        });

        it('produces correct string for a Feral-only Druid', () => {
            const trees = [
                {
                    name: 'Balance',
                    spentPoints: 0,
                    talents: [],
                },
                {
                    name: 'Feral Combat',
                    spentPoints: 5,
                    talents: [
                        { name: 'Ferocity', rank: 5 },
                    ],
                },
                {
                    name: 'Restoration',
                    spentPoints: 0,
                    talents: [],
                },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            // Balance: 0, Feral: ferocity is at a2 (1st talent in sorted order = position a2)
            // Feral sorted positions: a2, a3, b1, b2, b3, c1, c2, c3, d1, d2, d3, e1, e3, e4, f2, f3, g1, g2, g3, h3, i2
            // ferocity at index 0 → "5" + trailing zeros trimmed → "5"
            // Restoration: 0 → trimmed as trailing
            expect(result).toBe('0-5');
        });
    });

    describe('empty/zero talent handling', () => {
        it('returns all-zero trees as "0" when no talents are spent', () => {
            const trees = [
                { name: 'Balance', spentPoints: 0, talents: [] },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                { name: 'Restoration', spentPoints: 0, talents: [] },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            // All trees are "0", trailing trimming leaves just "0"
            expect(result).toBe('0');
        });

        it('returns "0" for an empty trees array', () => {
            const result = buildWowheadTalentString('Druid', []);

            // No trees matched → no tree strings produced → empty join
            // The function builds strings only for treeOrder keys; when no
            // matching tree data is found, each defaults to "0"
            // Then trailing "0" trees are trimmed, leaving "0"
            expect(result).toBe('0');
        });

        it('a tree with spentPoints=0 but non-empty talents still encodes the talents', () => {
            // The function uses slug matching regardless of spentPoints when
            // talents are present — spentPoints is metadata, not a gate.
            const trees = [
                {
                    name: 'Balance',
                    spentPoints: 0,
                    talents: [{ name: 'Starlight Wrath', rank: 5 }],
                },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                { name: 'Restoration', spentPoints: 0, talents: [] },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            // Talent data is still encoded even though spentPoints=0
            expect(result).toBe('5');
        });
    });

    describe('unknown class handling', () => {
        it('returns null for an unknown class', () => {
            const result = buildWowheadTalentString('Monk', []);
            expect(result).toBeNull();
        });
    });

    describe('API-position fallback', () => {
        it('uses tierIndex/columnIndex when available (API path)', () => {
            // Provide talents with tier/column indices matching known positions.
            // For Druid Balance:
            //   starlight-wrath is at a1 → tierIndex=0, columnIndex=0
            //   improved-moonfire is at b3 → tierIndex=1, columnIndex=2
            const trees = [
                {
                    name: 'Balance',
                    spentPoints: 10,
                    talents: [
                        { name: 'Starlight Wrath', rank: 5, tierIndex: 0, columnIndex: 0 },
                        { name: 'Improved Moonfire', rank: 5, tierIndex: 1, columnIndex: 2 },
                    ],
                },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                { name: 'Restoration', spentPoints: 0, talents: [] },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            // With API positions, buildTreeStringFromApi maps tierIndex/columnIndex
            // to the grid position format (letter + number), then looks up in the
            // sorted position list. The output should place ranks at the correct
            // position indices.
            expect(result).not.toBeNull();

            // Verify the result contains the expected non-zero digits
            const balanceString = result!.split('-')[0];
            expect(balanceString.length).toBeGreaterThan(0);
            // The exact encoding depends on sorted positions, but should not be "0"
            expect(balanceString).not.toBe('0');
        });

        it('falls back to slug matching when tierIndex/columnIndex are absent', () => {
            // No tierIndex/columnIndex → slug-based path
            const trees = [
                {
                    name: 'Balance',
                    spentPoints: 5,
                    talents: [
                        { name: 'Starlight Wrath', rank: 5 },
                    ],
                },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                { name: 'Restoration', spentPoints: 0, talents: [] },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            expect(result).not.toBeNull();
            // starlight-wrath is the first talent (position a1) → "5"
            expect(result!.startsWith('5')).toBe(true);
        });

        it('API positions produce same result as slug matching for known talents', () => {
            // Build the same talent set both ways and compare
            const slugTrees = [
                {
                    name: 'Balance',
                    spentPoints: 6,
                    talents: [
                        { name: 'Starlight Wrath', rank: 5 },
                        { name: "Nature's Grasp", rank: 1 },
                    ],
                },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                { name: 'Restoration', spentPoints: 0, talents: [] },
            ];

            const apiTrees = [
                {
                    name: 'Balance',
                    spentPoints: 6,
                    talents: [
                        // a1 = tierIndex 0, columnIndex 0
                        { name: 'Starlight Wrath', rank: 5, tierIndex: 0, columnIndex: 0 },
                        // a2 = tierIndex 0, columnIndex 1
                        { name: "Nature's Grasp", rank: 1, tierIndex: 0, columnIndex: 1 },
                    ],
                },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                { name: 'Restoration', spentPoints: 0, talents: [] },
            ];

            const slugResult = buildWowheadTalentString('Druid', slugTrees);
            const apiResult = buildWowheadTalentString('Druid', apiTrees);

            expect(slugResult).toBe(apiResult);
        });

        it('partial API positions falls back to slug matching', () => {
            // When only some talents have tierIndex/columnIndex, hasApiPositions
            // returns false (it requires ALL ranked talents to have positions)
            const trees = [
                {
                    name: 'Balance',
                    spentPoints: 6,
                    talents: [
                        { name: 'Starlight Wrath', rank: 5, tierIndex: 0, columnIndex: 0 },
                        { name: "Nature's Grasp", rank: 1 }, // no tierIndex/columnIndex
                    ],
                },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                { name: 'Restoration', spentPoints: 0, talents: [] },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            // Should still produce a valid result via slug fallback
            expect(result).not.toBeNull();
            expect(result!.startsWith('51')).toBe(true); // starlight-wrath(5) + natures-grasp(1)
        });
    });

    describe('trailing tree trimming', () => {
        it('trims trailing zero trees', () => {
            const trees = [
                {
                    name: 'Balance',
                    spentPoints: 5,
                    talents: [{ name: 'Starlight Wrath', rank: 5 }],
                },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                { name: 'Restoration', spentPoints: 0, talents: [] },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            // Only one tree string, trailing "0" trees are trimmed
            expect(result).not.toContain('-');
            expect(result).toBe('5');
        });

        it('keeps middle zero tree when later tree has points', () => {
            const trees = [
                {
                    name: 'Balance',
                    spentPoints: 5,
                    talents: [{ name: 'Starlight Wrath', rank: 5 }],
                },
                { name: 'Feral Combat', spentPoints: 0, talents: [] },
                {
                    name: 'Restoration',
                    spentPoints: 5,
                    talents: [{ name: 'Furor', rank: 5 }],
                },
            ];

            const result = buildWowheadTalentString('Druid', trees);

            // All three trees present: Balance-Feral-Restoration
            expect(result).toBe('5-0-05');
        });
    });

    describe('all classes have position maps', () => {
        it.each([
            'Druid', 'Hunter', 'Mage', 'Paladin', 'Priest',
            'Rogue', 'Shaman', 'Warlock', 'Warrior',
        ])('%s has exactly 3 talent trees', (className) => {
            const classMap = CLASSIC_TALENT_POSITIONS[className];
            expect(classMap).toBeDefined();
            expect(Object.keys(classMap)).toHaveLength(3);
        });

        it.each([
            'Druid', 'Hunter', 'Mage', 'Paladin', 'Priest',
            'Rogue', 'Shaman', 'Warlock', 'Warrior',
        ])('%s returns a non-null result for empty trees', (className) => {
            const classMap = CLASSIC_TALENT_POSITIONS[className];
            const treeOrder = Object.keys(classMap);

            const trees = treeOrder.map((name) => ({
                name,
                spentPoints: 0,
                talents: [],
            }));

            const result = buildWowheadTalentString(className, trees);
            expect(result).not.toBeNull();
            expect(result).toBe('0');
        });
    });

    describe('Warrior class talent string', () => {
        it('produces correct string for an Arms Warrior', () => {
            const trees = [
                {
                    name: 'Arms',
                    spentPoints: 5,
                    talents: [
                        { name: 'Improved Heroic Strike', rank: 3 },
                        { name: 'Deflection', rank: 2 },
                    ],
                },
                { name: 'Fury', spentPoints: 0, talents: [] },
                { name: 'Protection', spentPoints: 0, talents: [] },
            ];

            const result = buildWowheadTalentString('Warrior', trees);

            // Arms sorted: a1:improved-heroic-strike, a2:deflection, a3:improved-rend, ...
            // First two talents have ranks 3 and 2, rest are 0 → "32"
            expect(result).toBe('32');
        });
    });
});

// ---------------------------------------------------------------------------
// CLASSIC_TALENT_POSITIONS — structure validation
// ---------------------------------------------------------------------------

describe('CLASSIC_TALENT_POSITIONS', () => {
    it('all grid positions match the expected format (letter a-i + digit 1-4)', () => {
        const validPosition = /^[a-i][1-4]$/;

        for (const [className, classMap] of Object.entries(CLASSIC_TALENT_POSITIONS)) {
            for (const [treeName, treeMap] of Object.entries(classMap)) {
                for (const [slug, position] of Object.entries(treeMap)) {
                    expect(
                        validPosition.test(position),
                        `${className} > ${treeName} > ${slug}: "${position}" is not a valid grid position`,
                    ).toBe(true);
                }
            }
        }
    });

    it('no duplicate positions within a single tree', () => {
        for (const [className, classMap] of Object.entries(CLASSIC_TALENT_POSITIONS)) {
            for (const [treeName, treeMap] of Object.entries(classMap)) {
                const positions = Object.values(treeMap);
                const unique = new Set(positions);
                expect(
                    unique.size,
                    `${className} > ${treeName}: has duplicate positions`,
                ).toBe(positions.length);
            }
        }
    });
});
