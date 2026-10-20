import { z } from "zod";
import {
  ValheimCatalogEntrySchema,
  ValheimCatalogIconSchema,
  ValheimMapBaseMapSchema,
} from "./valheim-armory.schema.js";
import { ValheimPrefabIdSchema } from "./valheim-link-common.schema.js";
import { ValheimProcessorTypeSchema } from "./valheim-link-recipes-processing.schema.js";

/**
 * Member-facing recipe DTOs (ROK-1854): the planner catalogue, a single
 * item's craft tree and a multi-target plan. Trees are a flat node list with
 * `parentId` links — no recursive schema, a hard node cap, the web rebuilds
 * the hierarchy.
 */

/** Nodes per tree/plan response; `truncated` says the walk stopped here. */
export const VALHEIM_PLAN_NODES_MAX = 2000;
/** Targets per plan request. */
export const VALHEIM_PLAN_TARGETS_MAX = 20;

const count = z.number().int().min(0);
const quality = z.number().int().min(1).max(10);

export const ValheimRecipeCatalogEntrySchema = z
  .object({
    prefab: ValheimPrefabIdSchema,
    kind: z.enum(["item", "piece"]),
    name: z.string(),
    category: z.string(),
    icon: ValheimCatalogIconSchema.nullable(),
    /** Pieces are always 1. */
    maxQuality: quality,
    /** `recipes` 0 and `processes` 0 = gathered. */
    sources: z.object({ recipes: count, processes: count }).strict(),
  })
  .strict();
export type ValheimRecipeCatalogEntry = z.infer<
  typeof ValheimRecipeCatalogEntrySchema
>;

export const ValheimRecipeStationSchema = z
  .object({
    prefab: ValheimPrefabIdSchema,
    name: z.string(),
    maxLevel: z.number().int().min(1),
    upgrader: z.boolean(),
    icon: ValheimCatalogIconSchema.nullable(),
  })
  .strict();
export type ValheimRecipeStation = z.infer<typeof ValheimRecipeStationSchema>;

export const ValheimRecipeCatalogResponseSchema = z
  .object({
    gameVersion: z.string().nullable(),
    /** Minute precision; null when no recipes snapshot exists. */
    capturedAt: z.string().nullable(),
    /** True when names/icons come from the items catalogue of another game version. */
    catalogFallback: z.boolean(),
    entries: z.array(ValheimRecipeCatalogEntrySchema),
    stations: z.array(ValheimRecipeStationSchema),
    itemAtlas: ValheimMapBaseMapSchema.nullable(),
    recipeAtlas: ValheimMapBaseMapSchema.nullable(),
  })
  .strict();
export type ValheimRecipeCatalogResponse = z.infer<
  typeof ValheimRecipeCatalogResponseSchema
>;

export const ValheimPlanViaSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("recipe"),
      recipeId: z.string(),
      station: z.string().nullable(),
      stationLevel: z.number().int().min(0),
      quality,
      upgradeOnly: z.boolean(),
      formula: z.enum(["vanilla", "custom"]),
      anyOneOf: z.boolean(),
      upgraderStation: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("process"),
      processor: z.string(),
      processorType: ValheimProcessorTypeSchema,
      seconds: z.number().nullable(),
      windPowered: z.boolean(),
      fuel: z.string().nullable(),
    })
    .strict(),
  z.object({ type: z.literal("fuel") }).strict(),
  z.object({ type: z.literal("gathered") }).strict(),
  z.object({ type: z.literal("cycle") }).strict(),
]);
export type ValheimPlanVia = z.infer<typeof ValheimPlanViaSchema>;

export const ValheimPlanNodeSchema = z
  .object({
    id: count,
    parentId: count.nullable(),
    prefab: ValheimPrefabIdSchema,
    quantity: count,
    via: ValheimPlanViaSchema,
    /** Other recipes/processes that also produce this prefab. */
    alternatives: count,
    /** Craft operations needed for `quantity`. */
    crafts: count,
    /** Null in `/tree` and when no chest scan exists. */
    have: count.nullable(),
    short: count.nullable(),
  })
  .strict();
export type ValheimPlanNode = z.infer<typeof ValheimPlanNodeSchema>;

const nodes = z.array(ValheimPlanNodeSchema).max(VALHEIM_PLAN_NODES_MAX);

export const ValheimRecipeTreeResponseSchema = z
  .object({
    target: z.object({ prefab: ValheimPrefabIdSchema, quality }).strict(),
    nodes,
    truncated: z.boolean(),
    /** Catalogue entries for every prefab the nodes reference (names + icons). */
    items: z.record(z.string(), ValheimCatalogEntrySchema),
    itemAtlas: ValheimMapBaseMapSchema.nullable(),
    recipeAtlas: ValheimMapBaseMapSchema.nullable(),
  })
  .strict();
export type ValheimRecipeTreeResponse = z.infer<
  typeof ValheimRecipeTreeResponseSchema
>;

export const ValheimRecipePlanTargetSchema = z
  .object({
    prefab: ValheimPrefabIdSchema,
    quality,
    amount: z.number().int().min(1).max(10_000),
    /** 0 = craft from scratch; q0 ≥ 1 = upgrade from that quality. */
    fromQuality: z.number().int().min(0).max(10),
    /** Which source to plan when an item and a piece share a prefab; item when absent. */
    kind: z.enum(['item', 'piece']).optional(),
  })
  .strict();
export type ValheimRecipePlanTarget = z.infer<
  typeof ValheimRecipePlanTargetSchema
>;

export const ValheimRecipePlanBodySchema = z
  .object({
    targets: z
      .array(ValheimRecipePlanTargetSchema)
      .min(1)
      .max(VALHEIM_PLAN_TARGETS_MAX),
  })
  .strict();
export type ValheimRecipePlanBody = z.infer<typeof ValheimRecipePlanBodySchema>;

export const ValheimRecipePlanResponseSchema = z
  .object({
    targets: z.array(ValheimRecipePlanTargetSchema),
    nodes,
    truncated: z.boolean(),
    /** `scan` when the viewer's chest scan was netted; `none` otherwise. */
    stock: z.enum(["scan", "none"]),
    capturedAt: z.string().nullable(),
    /** Leaves only (gathered / cycle / fuel). */
    shoppingList: z.array(
      z
        .object({
          prefab: ValheimPrefabIdSchema,
          need: count,
          have: count.nullable(),
          short: count.nullable(),
        })
        .strict(),
    ),
    /** Cooking fuel — an estimate, never netted against stock. */
    fuelEstimates: z.array(
      z
        .object({
          prefab: ValheimPrefabIdSchema,
          processor: z.string(),
          seconds: z.number(),
        })
        .strict(),
    ),
    items: z.record(z.string(), ValheimCatalogEntrySchema),
    itemAtlas: ValheimMapBaseMapSchema.nullable(),
    recipeAtlas: ValheimMapBaseMapSchema.nullable(),
  })
  .strict();
export type ValheimRecipePlanResponse = z.infer<
  typeof ValheimRecipePlanResponseSchema
>;
