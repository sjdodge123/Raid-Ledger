import { describe, expect, it } from 'vitest';
import {
    ValheimPlanStepSchema,
    ValheimPlanViaSchema,
    ValheimRecipePlanResponseSchema,
    ValheimRecipeTreeResponseSchema,
} from '../valheim-recipes.schema.js';

/** ROK-1861 — per-quality steps on a recipe node + the upgrader station build map (additive). */
const step = (quality: number) => ({
    quality,
    station: 'upgrader_test',
    stationLevel: quality,
    anyOneOf: false,
    resources: [{ prefab: 'Bronze', amount: 3 }],
    upgraderStation: true,
});
const via = {
    type: 'recipe', recipeId: 'Recipe_ArmorBronzeChest', station: 'upgrader_test', stationLevel: 3, quality: 3,
    upgradeOnly: false, formula: 'vanilla', anyOneOf: false, upgraderStation: true,
};
const tree = {
    target: { prefab: 'ArmorBronzeChest', quality: 3 }, nodes: [], truncated: false, items: {},
    itemAtlas: null, recipeAtlas: null,
};
const plan = {
    targets: [], nodes: [], truncated: false, stock: 'none', capturedAt: null, shoppingList: [],
    fuelEstimates: [], items: {}, itemAtlas: null, recipeAtlas: null,
};
const builds = { upgrader_test: [{ prefab: 'Stone', amount: 10 }, { prefab: 'Bronze', amount: 2 }] };

describe('ValheimPlanStepSchema', () => {
    it('accepts a step and rejects a stray key', () => {
        expect(ValheimPlanStepSchema.safeParse(step(2)).success).toBe(true);
        expect(ValheimPlanStepSchema.safeParse({ ...step(2), crafts: 1 }).success).toBe(false);
    });

    it('requires upgraderStation and a 1..10 quality', () => {
        const { upgraderStation: _drop, ...noFlag } = step(2);
        expect(ValheimPlanStepSchema.safeParse(noFlag).success).toBe(false);
        expect(ValheimPlanStepSchema.safeParse(step(11)).success).toBe(false);
    });
});

describe('ValheimPlanViaSchema — recipe steps', () => {
    it('accepts a recipe via without steps (single-step nodes keep their shape)', () => {
        expect(ValheimPlanViaSchema.safeParse(via).success).toBe(true);
    });

    it('accepts up to 10 steps and rejects 11', () => {
        const ten = Array.from({ length: 10 }, (_, i) => step(i + 1));
        expect(ValheimPlanViaSchema.safeParse({ ...via, steps: ten }).success).toBe(true);
        expect(ValheimPlanViaSchema.safeParse({ ...via, steps: [...ten, step(10)] }).success).toBe(false);
    });
});

describe('stationBuilds on tree + plan responses', () => {
    it('is optional on both', () => {
        expect(ValheimRecipeTreeResponseSchema.safeParse(tree).success).toBe(true);
        expect(ValheimRecipePlanResponseSchema.safeParse(plan).success).toBe(true);
    });

    it('accepts a station → piece cost map on both', () => {
        expect(ValheimRecipeTreeResponseSchema.safeParse({ ...tree, stationBuilds: builds }).success).toBe(true);
        expect(ValheimRecipePlanResponseSchema.safeParse({ ...plan, stationBuilds: builds }).success).toBe(true);
    });

    it('rejects a zero amount or a stray key in a build line', () => {
        const zero = { upgrader_test: [{ prefab: 'Stone', amount: 0 }] };
        const stray = { upgrader_test: [{ prefab: 'Stone', amount: 1, recover: true }] };
        expect(ValheimRecipePlanResponseSchema.safeParse({ ...plan, stationBuilds: zero }).success).toBe(false);
        expect(ValheimRecipeTreeResponseSchema.safeParse({ ...tree, stationBuilds: stray }).success).toBe(false);
    });
});
