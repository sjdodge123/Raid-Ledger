import { z } from 'zod';
import { VALHEIM_LINK_PROCESS_INPUTS_MAX, ValheimPrefabIdSchema } from './valheim-link-common.schema.js';

/**
 * ROK-1854 — processing steps of the `recipes` kind: processors (smelter,
 * fermenter, cooking station, obliterator) and the processes they run.
 * Raw fields only; Raid Ledger computes nothing here (CONTRACT.md §5b).
 */

/** New values are additive (CONTRACT.md §9). */
export const ValheimProcessorTypeSchema = z.enum(['smelter', 'fermenter', 'cooking', 'incinerator']);
export type ValheimProcessorType = z.infer<typeof ValheimProcessorTypeSchema>;

export const ValheimProcessorSchema = z.object({
    /** Name and icon come from `pieces[]` when the processor is buildable. */
    prefab: ValheimPrefabIdSchema,
    type: ValheimProcessorTypeSchema,
    fuel: ValheimPrefabIdSchema.nullable(),
    /** Smelter only. */
    fuelPerProduct: z.number().int().min(0).max(1_000).nullable(),
    /** Cooking with fuel only. */
    fuelSecondsPerUnit: z.number().min(0.001).max(86_400).nullable(),
    windPowered: z.boolean(),
    requiresRoof: z.boolean(),
    maxInput: z.number().int().min(1).max(10_000).nullable(),
    /** Cooking `m_overCookedItem`. */
    burntResult: ValheimPrefabIdSchema.nullable(),
    /** Obliterator catch-all. */
    defaultResult: z.object({
        prefab: ValheimPrefabIdSchema,
        perInputs: z.number().int().min(1).max(10_000),
    }).strict().nullable(),
}).strict();
export type ValheimProcessor = z.infer<typeof ValheimProcessorSchema>;

export const ValheimProcessInputSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    amount: z.number().int().min(1).max(10_000),
}).strict();

export const ValheimProcessSchema = z.object({
    /** Must resolve to `processors[].prefab` (message refinement). */
    processor: ValheimPrefabIdSchema,
    inputs: z.array(ValheimProcessInputSchema).min(1).max(VALHEIM_LINK_PROCESS_INPUTS_MAX),
    /** Obliterator `m_requireOnlyOneIngredient`: inputs are alternatives. */
    anyOneOf: z.boolean(),
    output: z.object({
        prefab: ValheimPrefabIdSchema,
        amount: z.number().int().min(1).max(10_000),
    }).strict(),
    /** null for the obliterator. */
    seconds: z.number().min(0).max(604_800).nullable(),
    priority: z.number().int().min(-10_000).max(10_000),
}).strict().superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.inputs.forEach((i, idx) => {
        if (seen.has(i.prefab)) ctx.addIssue({ code: 'custom', path: ['inputs', idx, 'prefab'], message: 'duplicate input prefab' });
        seen.add(i.prefab);
    });
});
export type ValheimProcess = z.infer<typeof ValheimProcessSchema>;
