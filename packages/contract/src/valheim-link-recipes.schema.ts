import { z } from 'zod';
import {
    VALHEIM_LINK_PIECES_MAX,
    VALHEIM_LINK_PROCESSES_MAX,
    VALHEIM_LINK_PROCESSORS_MAX,
    VALHEIM_LINK_RECIPE_ENTRIES_MAX,
    VALHEIM_LINK_RECIPES_MAX,
    VALHEIM_LINK_REQUIREMENTS_MAX,
    VALHEIM_LINK_STATION_LEVEL_MAX,
    VALHEIM_LINK_STATIONS_MAX,
    ValheimBinaryRefSchema,
    ValheimPrefabIdSchema,
    valheimLinkHeaderShape,
} from './valheim-link-common.schema.js';
import { ValheimAtlasIconSchema, ValheimItemCategorySchema } from './valheim-link-items.schema.js';
import { ValheimProcessorSchema, ValheimProcessSchema } from './valheim-link-recipes-processing.schema.js';

/**
 * ROK-1854 — `kind: "recipes"`: an admin-client export of recipes, build
 * pieces, crafting stations and processing steps, keyed (`serverId`,
 * `gameVersion`). Raw `Piece.Requirement` fields only — Raid Ledger applies
 * the per-quality formula (CONTRACT.md §5b). Icons are atlas-only. ADDITIVE
 * under §9: the mod emits it only after its pin refresh.
 */

const amount = () => z.number().int().min(0).max(10_000);
const level = () => z.number().int().min(0).max(VALHEIM_LINK_STATION_LEVEL_MAX);

export const ValheimCraftingStationSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    name: z.string().min(1).max(96),
    /** 1 + distinct extension prefabs, capped at 20. */
    maxLevel: z.number().int().min(1).max(VALHEIM_LINK_STATION_LEVEL_MAX),
    /** An extension with `m_stack` exists: the level may exceed `maxLevel` in game. */
    stackableExtension: z.boolean(),
    /** 1.0.20 `CraftingStation.m_upgrader` (additive; absent on 0.221.x). */
    upgrader: z.boolean().optional(),
    icon: ValheimAtlasIconSchema.nullable(),
}).strict();
export type ValheimCraftingStation = z.infer<typeof ValheimCraftingStationSchema>;

export const ValheimRecipeResourceSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    amount: amount(),
    amountPerLevel: amount(),
    extraAmountOnlyOneIngredient: amount(),
    recover: z.boolean(),
    /** 1.0.20 `m_upgraderResource` (additive). */
    upgraderResource: z.boolean().optional(),
}).strict();
export type ValheimRecipeResource = z.infer<typeof ValheimRecipeResourceSchema>;

const uniquePrefabs = (list: ReadonlyArray<{ prefab: string }>, key: string, ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    list.forEach((r, i) => {
        if (seen.has(r.prefab)) ctx.addIssue({ code: 'custom', path: [key, i, 'prefab'], message: `duplicate ${key} prefab` });
        seen.add(r.prefab);
    });
};

export const ValheimRecipeSchema = z.object({
    /** Recipe asset name, or `<result>.<n>` when the asset has none. */
    id: z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/),
    /** The crafted item; resolved against the items catalogue, not in-message. */
    result: ValheimPrefabIdSchema,
    /** Items per craft. */
    amount: z.number().int().min(1).max(10_000),
    enabled: z.boolean(),
    /** Must resolve to `stations[].prefab` (message refinement). */
    station: ValheimPrefabIdSchema.nullable(),
    repairStation: ValheimPrefabIdSchema.nullable(),
    minStationLevel: level(),
    /** `m_noCraftOnlyUpgrade`. */
    upgradeOnly: z.boolean(),
    /** `m_requireOnlyOneIngredient`: resources are alternatives. */
    anyOneOf: z.boolean(),
    qualityResultAmountMultiplier: z.number().min(0).max(100),
    /** `custom` = the live per-quality values disagree with the §5b formula. */
    formula: z.enum(['vanilla', 'custom']),
    resources: z.array(ValheimRecipeResourceSchema).max(VALHEIM_LINK_REQUIREMENTS_MAX),
}).strict().superRefine((r, ctx) => uniquePrefabs(r.resources, 'resources', ctx));
export type ValheimRecipe = z.infer<typeof ValheimRecipeSchema>;

export const ValheimPieceResourceSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    amount: amount(),
    recover: z.boolean(),
}).strict();

export const ValheimPieceSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    name: z.string().min(1).max(96),
    /** `Piece.m_category`, an open set. */
    category: ValheimItemCategorySchema,
    /** The build tool (`Hammer`, `Hoe`, …); not resolvable in-message. */
    tool: ValheimPrefabIdSchema,
    /** Must resolve to `stations[].prefab` (message refinement). */
    station: ValheimPrefabIdSchema.nullable(),
    icon: ValheimAtlasIconSchema.nullable(),
    /** Pieces have no quality. */
    resources: z.array(ValheimPieceResourceSchema).max(VALHEIM_LINK_REQUIREMENTS_MAX),
}).strict().superRefine((p, ctx) => uniquePrefabs(p.resources, 'resources', ctx));
export type ValheimPiece = z.infer<typeof ValheimPieceSchema>;

type IconHolder = { icon: { kind: 'atlas'; x: number; y: number; w: number; h: number } | null };
function checkAtlasIcons(key: string, list: ReadonlyArray<IconHolder>, atlas: { width: number; height: number } | null, ctx: z.RefinementCtx): void {
    list.forEach((item, i) => {
        const icon = item.icon;
        if (!icon) return;
        if (!atlas) {
            ctx.addIssue({ code: 'custom', path: ['atlas'], message: 'atlas icon without an atlas' });
            return;
        }
        if (icon.x + icon.w > atlas.width || icon.y + icon.h > atlas.height) {
            ctx.addIssue({ code: 'custom', path: [key, i, 'icon'], message: 'icon outside atlas' });
        }
    });
}

export const ValheimRecipesMessageSchema = z.object({
    ...valheimLinkHeaderShape,
    kind: z.literal('recipes'),
    /** Language of piece / station names, e.g. `English`. */
    locale: z.string().regex(/^[A-Za-z_-]{2,32}$/),
    /** Piece + station icons; required when any icon is non-null. */
    atlas: ValheimBinaryRefSchema.nullable(),
    stations: z.array(ValheimCraftingStationSchema).max(VALHEIM_LINK_STATIONS_MAX),
    recipes: z.array(ValheimRecipeSchema).max(VALHEIM_LINK_RECIPES_MAX),
    pieces: z.array(ValheimPieceSchema).max(VALHEIM_LINK_PIECES_MAX),
    processors: z.array(ValheimProcessorSchema).max(VALHEIM_LINK_PROCESSORS_MAX),
    /** Sorted by processor, then priority desc (the mod sorts; not checked here). */
    processes: z.array(ValheimProcessSchema).max(VALHEIM_LINK_PROCESSES_MAX),
}).strict().superRefine((msg, ctx) => {
    uniquePrefabs(msg.stations, 'stations', ctx);
    uniquePrefabs(msg.pieces, 'pieces', ctx);
    uniquePrefabs(msg.processors, 'processors', ctx);
    const ids = new Set<string>();
    msg.recipes.forEach((r, i) => {
        if (ids.has(r.id)) ctx.addIssue({ code: 'custom', path: ['recipes', i, 'id'], message: 'duplicate recipe id' });
        ids.add(r.id);
    });
    const stations = new Set(msg.stations.map((s) => s.prefab));
    msg.recipes.forEach((r, i) => {
        for (const field of ['station', 'repairStation'] as const) {
            const ref = r[field];
            if (ref !== null && !stations.has(ref)) ctx.addIssue({ code: 'custom', path: ['recipes', i, field], message: 'unknown station' });
        }
    });
    msg.pieces.forEach((p, i) => {
        if (p.station !== null && !stations.has(p.station)) ctx.addIssue({ code: 'custom', path: ['pieces', i, 'station'], message: 'unknown station' });
    });
    const processors = new Set(msg.processors.map((p) => p.prefab));
    msg.processes.forEach((p, i) => {
        if (!processors.has(p.processor)) ctx.addIssue({ code: 'custom', path: ['processes', i, 'processor'], message: 'unknown processor' });
    });
    checkAtlasIcons('stations', msg.stations, msg.atlas, ctx);
    checkAtlasIcons('pieces', msg.pieces, msg.atlas, ctx);
    const entries = msg.recipes.reduce((n, r) => n + r.resources.length, 0)
        + msg.pieces.reduce((n, p) => n + p.resources.length, 0)
        + msg.processes.reduce((n, p) => n + p.inputs.length, 0);
    if (entries > VALHEIM_LINK_RECIPE_ENTRIES_MAX) {
        ctx.addIssue({
            code: 'too_big',
            origin: 'array',
            maximum: VALHEIM_LINK_RECIPE_ENTRIES_MAX,
            inclusive: true,
            path: [],
            message: `recipe resources, piece resources and process inputs exceed ${VALHEIM_LINK_RECIPE_ENTRIES_MAX} in total`,
        });
    }
});
export type ValheimRecipesMessage = z.infer<typeof ValheimRecipesMessageSchema>;
