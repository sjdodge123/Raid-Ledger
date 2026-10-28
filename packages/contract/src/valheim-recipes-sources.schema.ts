import { z } from "zod";
import { ValheimPrefabIdSchema } from "./valheim-link-common.schema.js";
import { ValheimProcessorTypeSchema } from "./valheim-link-recipes-processing.schema.js";

/**
 * ROK-1860: the Planner source picker. A source ref names ONE way to make a
 * prefab — a recipe by its export id, or a process by its processor plus the
 * position among that processor's processes for the prefab (graph order).
 */

/** Per-prefab source overrides per `/plan` or `/tree` request (`sources=`). */
export const VALHEIM_PLAN_SOURCES_MAX = 64;

/** Source options listed per catalogue entry. */
const SOURCE_OPTIONS_MAX = 16;

export const ValheimRecipeSourceRefSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("recipe"),
      recipeId: z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/),
    })
    .strict(),
  z
    .object({
      type: z.literal("process"),
      processor: ValheimPrefabIdSchema,
      index: z.number().int().min(0).max(63),
    })
    .strict(),
]);
export type ValheimRecipeSourceRef = z.infer<typeof ValheimRecipeSourceRefSchema>;

/** One offered source of a catalogue item (step 1 / quality 1 totals). */
export const ValheimRecipeSourceOptionSchema = z
  .object({
    ref: ValheimRecipeSourceRefSchema,
    /** Crafting station, or the processor prefab for a process; null = by hand. */
    station: z.string().nullable(),
    stationLevel: z.number().int().min(0),
    /** Process options only. */
    processorType: ValheimProcessorTypeSchema.optional(),
    outputAmount: z.number().int().min(1),
    upgradeOnly: z.boolean(),
    resources: z
      .array(
        z
          .object({ prefab: ValheimPrefabIdSchema, amount: z.number().int().min(1) })
          .strict(),
      )
      .max(16),
    /** The source the resolver picks when no override is given. */
    default: z.boolean(),
    /** ROK-1862: the viewer's character knows the recipe; null = not gated or unknown. */
    discovered: z.boolean().nullable().optional(),
  })
  .strict();
export type ValheimRecipeSourceOption = z.infer<
  typeof ValheimRecipeSourceOptionSchema
>;

/** `sourceOptions` on a catalogue entry: present only for items with ≥2 offered sources. */
export const ValheimRecipeSourceOptionsSchema = z
  .array(ValheimRecipeSourceOptionSchema)
  .max(SOURCE_OPTIONS_MAX);
