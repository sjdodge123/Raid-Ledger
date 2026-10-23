/** ROK-1899 — the crafting window's pure view model: affordability, slots, station groups, order, row descriptions. */
import { describe, expect, it } from 'vitest';
import type { ValheimRecipeCatalogEntry, ValheimRecipeCost } from '@raid-ledger/contract';
import { recipeCatalogFixture } from '../../../test/mocks/valheim-recipes-handlers';
import {
    BY_HAND_KEY,
    affordability,
    rowDescription,
    searchRows,
    slotLines,
    sortRows,
    stationGroups,
} from './crafting.helpers';

const cost = (resources: [string, number][], anyOneOf = false): ValheimRecipeCost => ({
    station: 'forge', stationLevel: 1, anyOneOf, resources: resources.map(([prefab, amount]) => ({ prefab, amount })),
});
const bronze = cost([['Copper', 2], ['Tin', 1]]);
const names: Record<string, string> = { Copper: 'Copper', Tin: 'Tin', Wood: 'Wood' };
const nameOf = (p: string): string => names[p] ?? p;

function entry(prefab: string, name: string, craftStation: string | null, over: Partial<ValheimRecipeCatalogEntry> = {}): ValheimRecipeCatalogEntry {
    return {
        prefab, kind: 'item', name, category: 'Weapon', icon: null, maxQuality: 1, sources: { recipes: 1, processes: 0 },
        craft: { ...cost([['Wood', 1]]), station: craftStation, via: 'recipe', amount: 1 }, upgrades: [], ...over,
    };
}
const stations = recipeCatalogFixture().stations;
const filters = { kind: 'item', category: null } as const;

describe('affordability', () => {
    it('can when every resource is covered', () => {
        expect(affordability(bronze, { Copper: 2, Tin: 1 })).toEqual({ state: 'can' });
    });
    it('short lists each shortfall as need − have; a missing prefab counts 0', () => {
        expect(affordability(bronze, { Copper: 40 })).toEqual({ state: 'short', anyOneOf: false, missing: [{ prefab: 'Tin', more: 1 }] });
        expect(affordability(bronze, { Copper: 1 })).toEqual({
            state: 'short', anyOneOf: false, missing: [{ prefab: 'Copper', more: 1 }, { prefab: 'Tin', more: 1 }],
        });
    });
    it('anyOneOf is covered by any one resource', () => {
        const meat = cost([['RawMeat', 2], ['DeerMeat', 3]], true);
        expect(affordability(meat, { DeerMeat: 3 })).toEqual({ state: 'can' });
        expect(affordability(meat, { RawMeat: 1 })).toEqual({
            state: 'short', anyOneOf: true, missing: [{ prefab: 'RawMeat', more: 1 }, { prefab: 'DeerMeat', more: 3 }],
        });
    });
    it('unknown without totals (no scan, or still loading)', () => {
        expect(affordability(bronze, null)).toEqual({ state: 'unknown' });
    });
});

describe('slotLines', () => {
    it('one line per resource with have and short; null totals give null have/short', () => {
        expect(slotLines(bronze, { Copper: 40 })).toEqual([
            { prefab: 'Copper', need: 2, have: 40, short: 0 },
            { prefab: 'Tin', need: 1, have: 0, short: 1 },
        ]);
        expect(slotLines(bronze, null)).toEqual([
            { prefab: 'Copper', need: 2, have: null, short: null },
            { prefab: 'Tin', need: 1, have: null, short: null },
        ]);
    });
});

describe('rowDescription', () => {
    it('names every shortfall; nothing for can/unknown', () => {
        expect(rowDescription(affordability(bronze, { Copper: 40 }), nameOf)).toBe("Can't craft yet: need 1 more Tin");
        expect(rowDescription(affordability(cost([['Wood', 9], ['Tin', 1]]), { Wood: 2 }), nameOf)).toBe("Can't craft yet: need 7 more Wood, 1 more Tin");
        expect(rowDescription(affordability(cost([['Wood', 9], ['Tin', 1]], true), {}), nameOf)).toBe("Can't craft yet: need one of 9 more Wood or 1 more Tin");
        expect(rowDescription({ state: 'can' }, nameOf)).toBeUndefined();
        expect(rowDescription({ state: 'unknown' }, nameOf)).toBeUndefined();
    });
});

describe('stationGroups', () => {
    const entries = [
        entry('SwordIron', 'Iron sword', 'forge'),
        entry('Club', 'Club', 'piece_workbench'),
        entry('Torch', 'Torch', null),
        entry('piece_chest', 'Chest', 'piece_workbench', { kind: 'piece', category: 'Furniture' }),
        entry('Iron', 'Iron', 'smelter', { craft: { ...cost([['IronScrap', 1]]), station: 'smelter', via: 'process', amount: 1 } }),
        entry('KnifeSilver', 'Silver knife', null, { craft: null, upgrades: [{ ...cost([['Silver', 2]]), quality: 2, upgraderStation: false }] }),
    ];
    it('CRAFT: stations by name, then By hand; Kind/Category narrow; process outputs have no station entry', () => {
        const groups = stationGroups(entries, stations, 'craft', filters);
        expect(groups.map((g) => [g.key, g.label, g.maxLevel, g.rows.map((r) => r.entry.prefab)])).toEqual([
            ['forge', 'Forge', 7, ['SwordIron']],
            ['piece_workbench', 'Workbench', 5, ['Club']],
            [BY_HAND_KEY, 'By hand', null, ['Torch']],
        ]);
        expect(stationGroups(entries, stations, 'craft', { kind: 'piece', category: null }).map((g) => g.rows.map((r) => r.entry.prefab))).toEqual([['piece_chest']]);
        expect(stationGroups(entries, stations, 'craft', { kind: 'both', category: 'Furniture' }).map((g) => g.key)).toEqual(['piece_workbench']);
    });
    it('UPGRADE: entries with upgrades, grouped by their q2 step station; the row cost is that step', () => {
        const groups = stationGroups(entries, stations, 'upgrade', filters);
        expect(groups.map((g) => [g.key, g.rows.map((r) => [r.entry.prefab, r.cost.resources[0]?.prefab])])).toEqual([['forge', [['KnifeSilver', 'Silver']]]]);
    });
    it('search spans every station of the mode, matching name or prefab, each row keeping its station', () => {
        const groups = stationGroups(entries, stations, 'craft', { kind: 'both', category: null });
        expect(searchRows(groups, 'c').map((r) => [r.entry.prefab, r.stationLabel])).toEqual([
            ['Club', 'Workbench'], ['piece_chest', 'Workbench'], ['Torch', 'By hand'],
        ]);
        expect(searchRows(groups, 'SWORDIRON').map((r) => r.entry.prefab)).toEqual(['SwordIron']);
        expect(searchRows(groups, '  ')).toEqual([]);
    });
});

describe('sortRows', () => {
    it('can → short → unknown, each by name', () => {
        const rows = [
            entry('B', 'Bravo', 'forge', { craft: { ...cost([['Tin', 1]]), via: 'recipe', amount: 1 } }),
            entry('A', 'Alpha', 'forge', { craft: { ...cost([['Tin', 1]]), via: 'recipe', amount: 1 } }),
            entry('C', 'Charlie', 'forge'),
        ].map((e) => ({ entry: e, cost: e.craft ?? bronze, stationKey: 'forge', stationLabel: 'Forge' }));
        expect(sortRows(rows, { Wood: 1 }).map((r) => [r.entry.name, r.afford.state])).toEqual([
            ['Charlie', 'can'], ['Alpha', 'short'], ['Bravo', 'short'],
        ]);
        expect(sortRows(rows, null).map((r) => r.entry.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });
});
