import { z } from "zod";
import {
  ValheimCatalogEntrySchema,
  ValheimCatalogIconSchema,
  ValheimMapBaseMapSchema,
} from "./valheim-armory.schema.js";
import {
  VALHEIM_LINK_REQUIREMENTS_MAX,
  ValheimPrefabIdSchema,
} from "./valheim-link-common.schema.js";
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

/** Upper bound for every propagated quantity; the resolver stops a branch (and marks the response truncated) before exceeding it. */
export const VALHEIM_PLAN_QUANTITY_MAX = 1_000_000_000;

const count = z.number().int().min(0).max(VALHEIM_PLAN_QUANTITY_MAX);
const quality = z.number().int().min(1).max(10);

/** One crafting or upgrade step's direct cost (ROK-1899): station, level and ingredients. */
export const ValheimRecipeCostSchema = z
  .object({
    station: ValheimPrefabIdSchema.nullable(),
    stationLevel: z.number().int().min(0),
    /** Any ONE resource covers the cost (e.g. a choice of meats). */
    anyOneOf: z.boolean(),
    resources: z
      .array(
        z
          .object({ prefab: ValheimPrefabIdSchema, amount: z.number().int().min(1) })
          .strict(),
      )
      .max(VALHEIM_LINK_REQUIREMENTS_MAX),
  })
  .strict();
export type ValheimRecipeCost = z.infer<typeof ValheimRecipeCostSchema>;

/** The CRAFT tab: how quality 1 is made. */
export const ValheimRecipeCraftSchema = ValheimRecipeCostSchema.extend({
  via: z.enum(["recipe", "piece", "process"]),
  /** Output per craft ("Wood arrow ×20"). */
  amount: z.number().int().min(1),
}).strict();
export type ValheimRecipeCraft = z.infer<typeof ValheimRecipeCraftSchema>;

/** The UPGRADE tab: the step that produces `quality` from `quality - 1`. */
export const ValheimRecipeUpgradeSchema = ValheimRecipeCostSchema.extend({
  quality: z.number().int().min(2).max(10),
  upgraderStation: z.boolean(),
}).strict();
export type ValheimRecipeUpgrade = z.infer<typeof ValheimRecipeUpgradeSchema>;

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
    /** Null when nothing crafts or processes it (gathered). */
    craft: ValheimRecipeCraftSchema.nullable(),
    /** Qualities 2..maxQuality in order; empty for pieces and maxQuality 1. */
    upgrades: z.array(ValheimRecipeUpgradeSchema).max(9),
    /** ROK-1862: the viewer's character knows it; null = not gated or unknown. */
    discovered: z.boolean().nullable().optional(),
  })
  .strict();
export type ValheimRecipeCatalogEntry = z.infer<
  typeof ValheimRecipeCatalogEntrySchema
>;

/**
 * ROK-1862 D5: `known` = lists used; `no-character` = no valid claim;
 * `truncated` = a list hit the cap; `outdated` = every claimed list holds only
 * pre-0.4.2 `_item_*`/`_piece_*` name tokens (mod too old to compare).
 */
export const ValheimRecipeDiscoverySchema = z.enum([
  "known",
  "no-character",
  "truncated",
  "outdated",
]);
export type ValheimRecipeDiscovery = z.infer<
  typeof ValheimRecipeDiscoverySchema
>;

/**
 * ROK-1948 D4: server-wide spoiler protection. `protected` = only what some
 * character on the server has discovered is shown; `off-no-data` = no usable
 * (non-empty, 0.4.2+) known list on the server; `off-truncated` = a list hit
 * the store cap. Off = everything shows, as before.
 */
export const ValheimRecipeSpoilersSchema = z.enum([
  "protected",
  "off-no-data",
  "off-truncated",
]);
export type ValheimRecipeSpoilers = z.infer<typeof ValheimRecipeSpoilersSchema>;

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
    /**
     * Names + icons for every prefab with a catalogue row that is named in any
     * entry's `craft`/`upgrades` resources. A prefab with no items-catalogue row
     * is absent; the client then shows the prefab id.
     */
    ingredients: z.record(z.string(), ValheimCatalogEntrySchema),
    itemAtlas: ValheimMapBaseMapSchema.nullable(),
    recipeAtlas: ValheimMapBaseMapSchema.nullable(),
    discovery: ValheimRecipeDiscoverySchema.optional(),
    spoilers: ValheimRecipeSpoilersSchema.optional(),
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
  /** ROK-1948 D7: needs something nobody on the server has found yet — a leaf, no names. */
  z.object({ type: z.literal("undiscovered") }).strict(),
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
    /** ROK-1862: as on catalogue entries; null for process/gathered/fuel/cycle. */
    discovered: z.boolean().nullable().optional(),
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
    discovery: ValheimRecipeDiscoverySchema.optional(),
    spoilers: ValheimRecipeSpoilersSchema.optional(),
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
    discovery: ValheimRecipeDiscoverySchema.optional(),
    spoilers: ValheimRecipeSpoilersSchema.optional(),
  })
  .strict();
export type ValheimRecipePlanResponse = z.infer<
  typeof ValheimRecipePlanResponseSchema
>;

/** `GET …/recipes/stock` (ROK-1899): the viewer's netted chest totals, same scope as `/plan`. */
export const ValheimRecipeStockResponseSchema = z
  .object({
    stock: z.enum(["scan", "none"]),
    capturedAt: z.string().nullable(),
    /** prefab → count, summed across qualities. */
    totals: z.record(z.string(), count),
  })
  .strict();
export type ValheimRecipeStockResponse = z.infer<
  typeof ValheimRecipeStockResponseSchema
>;
