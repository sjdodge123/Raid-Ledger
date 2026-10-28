import { describe, expect, it } from 'vitest';
import {
    VALHEIM_PLAN_SOURCES_MAX,
    ValheimRecipeSourceOptionSchema,
    ValheimRecipeSourceRefSchema,
} from '../valheim-recipes-sources.schema.js';
import { ValheimRecipeCatalogEntrySchema } from '../valheim-recipes.schema.js';

/** ROK-1860 — Planner source picker: source refs + catalogue `sourceOptions` (additive). */
const recipeRef = { type: 'recipe', recipeId: 'Recipe_Bronze5' };
const processRef = { type: 'process', processor: 'smelter', index: 0 };
const option = {
    ref: recipeRef, station: 'forge', stationLevel: 1, outputAmount: 5, upgradeOnly: false,
    resources: [{ prefab: 'Copper', amount: 10 }, { prefab: 'Tin', amount: 5 }], default: false,
};
const processOption = {
    ...option, ref: processRef, station: 'smelter', stationLevel: 0, processorType: 'smelter',
    outputAmount: 1, resources: [{ prefab: 'CopperOre', amount: 1 }], default: true,
};
const entry = {
    prefab: 'Bronze', kind: 'item', name: 'Bronze', category: 'Materials', icon: null, maxQuality: 1,
    sources: { recipes: 2, processes: 0 }, craft: null, upgrades: [],
};

describe('VALHEIM_PLAN_SOURCES_MAX', () => {
    it('caps a request at 64 overrides', () => {
        expect(VALHEIM_PLAN_SOURCES_MAX).toBe(64);
    });
});

describe('ValheimRecipeSourceRefSchema', () => {
    it('accepts a recipe ref and a process ref', () => {
        expect(ValheimRecipeSourceRefSchema.safeParse(recipeRef).success).toBe(true);
        expect(ValheimRecipeSourceRefSchema.safeParse({ type: 'recipe', recipeId: 'a.b-c_9' }).success).toBe(true);
        expect(ValheimRecipeSourceRefSchema.safeParse(processRef).success).toBe(true);
        expect(ValheimRecipeSourceRefSchema.safeParse({ ...processRef, index: 63 }).success).toBe(true);
    });

    it('rejects recipe ids with separator or other characters, empty or over 96 chars', () => {
        for (const recipeId of ['Bronze:5', 'a,b', 'a b', 'Rezept_Ä', '', 'x'.repeat(97)]) {
            expect(ValheimRecipeSourceRefSchema.safeParse({ type: 'recipe', recipeId }).success).toBe(false);
        }
        expect(ValheimRecipeSourceRefSchema.safeParse({ type: 'recipe', recipeId: 'x'.repeat(96) }).success).toBe(true);
    });

    it('rejects a process index outside 0..63 or not an integer', () => {
        for (const index of [64, -1, 0.5]) {
            expect(ValheimRecipeSourceRefSchema.safeParse({ ...processRef, index }).success).toBe(false);
        }
    });

    it('rejects extra keys, a missing part and an unknown type', () => {
        expect(ValheimRecipeSourceRefSchema.safeParse({ ...recipeRef, index: 0 }).success).toBe(false);
        expect(ValheimRecipeSourceRefSchema.safeParse({ ...processRef, recipeId: 'x' }).success).toBe(false);
        expect(ValheimRecipeSourceRefSchema.safeParse({ type: 'process', processor: 'smelter' }).success).toBe(false);
        expect(ValheimRecipeSourceRefSchema.safeParse({ type: 'fuel' }).success).toBe(false);
    });
});

describe('ValheimRecipeSourceOptionSchema', () => {
    it('accepts recipe and process options, with or without discovered', () => {
        expect(ValheimRecipeSourceOptionSchema.safeParse(option).success).toBe(true);
        expect(ValheimRecipeSourceOptionSchema.safeParse(processOption).success).toBe(true);
        expect(ValheimRecipeSourceOptionSchema.safeParse({ ...option, station: null, discovered: false }).success).toBe(true);
        expect(ValheimRecipeSourceOptionSchema.safeParse({ ...option, discovered: null }).success).toBe(true);
    });

    it('rejects a stray key, a zero output and a missing default flag', () => {
        expect(ValheimRecipeSourceOptionSchema.safeParse({ ...option, crafts: 1 }).success).toBe(false);
        expect(ValheimRecipeSourceOptionSchema.safeParse({ ...option, outputAmount: 0 }).success).toBe(false);
        const { default: _drop, ...noDefault } = option;
        expect(ValheimRecipeSourceOptionSchema.safeParse(noDefault).success).toBe(false);
    });

    it('caps resources at 16', () => {
        const resources = Array.from({ length: 17 }, (_, i) => ({ prefab: `Res${i}`, amount: 1 }));
        expect(ValheimRecipeSourceOptionSchema.safeParse({ ...option, resources }).success).toBe(false);
        expect(ValheimRecipeSourceOptionSchema.safeParse({ ...option, resources: resources.slice(0, 16) }).success).toBe(true);
    });
});

describe('ValheimRecipeCatalogEntrySchema.sourceOptions', () => {
    it('accepts an entry with and without sourceOptions', () => {
        expect(ValheimRecipeCatalogEntrySchema.safeParse(entry).success).toBe(true);
        const withOptions = { ...entry, sourceOptions: [option, processOption] };
        const parsed = ValheimRecipeCatalogEntrySchema.safeParse(withOptions);
        expect(parsed.success).toBe(true);
        expect(parsed.data?.sourceOptions).toHaveLength(2);
    });

    it('rejects more than 16 options and a malformed option', () => {
        const many = Array.from({ length: 17 }, () => option);
        expect(ValheimRecipeCatalogEntrySchema.safeParse({ ...entry, sourceOptions: many }).success).toBe(false);
        expect(ValheimRecipeCatalogEntrySchema.safeParse({ ...entry, sourceOptions: many.slice(0, 16) }).success).toBe(true);
        const bad = { ...option, ref: { type: 'recipe', recipeId: 'Bronze:5' } };
        expect(ValheimRecipeCatalogEntrySchema.safeParse({ ...entry, sourceOptions: [bad] }).success).toBe(false);
    });
});
