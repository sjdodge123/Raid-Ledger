import { describe, expect, it } from 'vitest';
import { VALHEIM_LINK_RECIPE_ENTRIES_MAX } from '../valheim-link-common.schema.js';
import { ValheimLinkMessageKindSchema, ValheimLinkMessageSchema } from '../valheim-link-message.schema.js';
import { ValheimRecipesMessageSchema } from '../valheim-link-recipes.schema.js';

/** ROK-1854 — the `recipes` kind: refinements the JSON schema cannot express. */
const station = { prefab: 'piece_workbench', name: 'Workbench', maxLevel: 5, stackableExtension: false, icon: null };
const resource = (prefab: string, amount = 1) => ({ prefab, amount, amountPerLevel: 1, extraAmountOnlyOneIngredient: 0, recover: true });
const recipe = (id: string, extra: Record<string, unknown> = {}) => ({
    id, result: 'SwordIron', amount: 1, enabled: true, station: 'piece_workbench', repairStation: null, minStationLevel: 1,
    upgradeOnly: false, anyOneOf: false, qualityResultAmountMultiplier: 1, formula: 'vanilla', resources: [resource('Iron', 2), resource('Wood', 1)], ...extra,
});
const processor = { prefab: 'smelter', type: 'smelter', fuel: 'Coal', fuelPerProduct: 2, fuelSecondsPerUnit: null, windPowered: false, requiresRoof: false, maxInput: 10, burntResult: null, defaultResult: null };
const process = { processor: 'smelter', inputs: [{ prefab: 'IronScrap', amount: 1 }], anyOneOf: false, output: { prefab: 'Iron', amount: 1 }, seconds: 31, priority: 0 };
const basic = {
    schemaVersion: 1, serverId: 'srv_fixture_01', capturedAt: '2026-10-17T20:15:00Z', gameVersion: '0.220.5', modVersion: '1.0.0',
    kind: 'recipes', locale: 'English', atlas: null, stations: [station], recipes: [recipe('Recipe_SwordIron')],
    pieces: [{ prefab: 'piece_chest', name: 'Chest', category: 'Furniture', tool: 'Hammer', station: 'piece_workbench', icon: null, resources: [{ prefab: 'Wood', amount: 10, recover: true }] }],
    processors: [processor], processes: [process],
};
const issue = (msg: unknown, path: string, code: string): boolean => {
    const res = ValheimLinkMessageSchema.safeParse(msg);
    return !res.success && res.error.issues.some((i) => i.path.join('.') === path && i.code === code);
};

describe('ValheimRecipesMessageSchema (ROK-1854)', () => {
    it('is a member of the message union and of the kind enum', () => {
        expect(ValheimLinkMessageSchema.safeParse(basic).success).toBe(true);
        expect(ValheimLinkMessageKindSchema.options).toContain('recipes');
    });
    it('station and processor references must resolve in-message', () => {
        expect(issue({ ...basic, recipes: [recipe('r', { station: 'piece_forge' })] }, 'recipes.0.station', 'custom')).toBe(true);
        expect(issue({ ...basic, pieces: [{ ...basic.pieces[0], station: 'piece_forge' }] }, 'pieces.0.station', 'custom')).toBe(true);
        expect(issue({ ...basic, processes: [{ ...process, processor: 'kiln' }] }, 'processes.0.processor', 'custom')).toBe(true);
    });
    it('recipe ids and piece/station/processor prefabs are unique; resources unique per recipe', () => {
        expect(issue({ ...basic, recipes: [recipe('r'), recipe('r')] }, 'recipes.1.id', 'custom')).toBe(true);
        expect(issue({ ...basic, stations: [station, station] }, 'stations.1.prefab', 'custom')).toBe(true);
        expect(issue({ ...basic, recipes: [recipe('r', { resources: [resource('Iron'), resource('Iron')] })] }, 'recipes.0.resources.1.prefab', 'custom')).toBe(true);
    });
    it('an atlas icon needs an atlas', () => {
        const icon = { kind: 'atlas', x: 0, y: 0, w: 64, h: 64 };
        expect(issue({ ...basic, stations: [{ ...station, icon }] }, 'atlas', 'custom')).toBe(true);
    });
    it('caps the entries summed over recipes, pieces and processes', () => {
        const many = Array.from({ length: Math.ceil((VALHEIM_LINK_RECIPE_ENTRIES_MAX + 1) / 16) }, (_, i) =>
            recipe(`r${i}`, { resources: Array.from({ length: 16 }, (_, j) => resource(`p${j}`)) }));
        const res = ValheimRecipesMessageSchema.safeParse({ ...basic, recipes: many });
        expect(res.success).toBe(false);
        expect(res.error?.issues.some((i) => i.code === 'too_big' && i.path.length === 0)).toBe(true);
    });
});
