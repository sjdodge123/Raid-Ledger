import { z } from 'zod';
import { ValheimCatalogEntrySchema, ValheimMapBaseMapSchema } from './valheim-armory.schema.js';
import { ValheimPrefabIdSchema } from './valheim-link-common.schema.js';
import { ValheimWorldCoordSchema } from './valheim-link-map.schema.js';

/**
 * ROK-1853 — what members read on the hub Materials tab. Additive. No row id,
 * no `creatorPlayerId`, no SteamID anywhere: a container is addressed by an
 * opaque 22-char key (design §3.2), and `private` collapses to `personal` on
 * the read side (`group` is shared).
 */

export const ValheimMaterialStackSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    quality: z.number().int().min(1).max(10),
    /** Sum over the visible containers. */
    total: z.number().int().min(0),
    /** Containers holding at least one of this stack. */
    chests: z.number().int().min(1),
}).strict();
export type ValheimMaterialStack = z.infer<typeof ValheimMaterialStackSchema>;

export const ValheimMaterialsWarningsSchema = z.object({
    unreadable: z.number().int().min(0),
    omittedEntries: z.number().int().min(0),
    omittedShared: z.number().int().min(0),
}).strict();

export const ValheimMaterialsSharedSchema = z.object({
    totals: z.array(ValheimMaterialStackSchema),
    chestCount: z.number().int().min(0),
    warnings: ValheimMaterialsWarningsSchema,
}).strict();

export const ValheimMaterialsPersonalSchema = z.object({
    totals: z.array(ValheimMaterialStackSchema),
    chestCount: z.number().int().min(0),
    /** Admins only; null for everyone else. */
    omittedPrivate: z.number().int().min(0).nullable(),
}).strict();

export const ValheimMaterialsResponseSchema = z.object({
    /** null = no scan yet (empty state). */
    worldUid: z.string().nullable(),
    /** ISO, truncated to the minute server-side. */
    capturedAt: z.string().nullable(),
    gameVersion: z.string().nullable(),
    /** The catalogue is the newest one, not the scan's game version. */
    catalogFallback: z.boolean(),
    shared: ValheimMaterialsSharedSchema,
    /** null = the viewer may see no personal chests. */
    personal: ValheimMaterialsPersonalSchema.nullable(),
    items: z.record(z.string(), ValheimCatalogEntrySchema),
    atlas: ValheimMapBaseMapSchema.nullable(),
}).strict();
export type ValheimMaterialsResponse = z.infer<typeof ValheimMaterialsResponseSchema>;

export const ValheimContainerVisibilitySchema = z.enum(['shared', 'personal']);
export type ValheimContainerVisibility = z.infer<typeof ValheimContainerVisibilitySchema>;

export const ValheimContainerSummarySchema = z.object({
    /** Opaque, stable across re-imports; never a row id. */
    key: z.string().length(22),
    prefab: ValheimPrefabIdSchema,
    x: ValheimWorldCoordSchema,
    y: ValheimWorldCoordSchema,
    z: ValheimWorldCoordSchema,
    privacy: ValheimContainerVisibilitySchema,
    vehicle: z.boolean(),
    slots: z.number().int().min(1),
    usedSlots: z.number().int().min(0),
    unreadable: z.boolean(),
    omittedEntries: z.number().int().min(0),
    stackCount: z.number().int().min(0),
}).strict();
export type ValheimContainerSummary = z.infer<typeof ValheimContainerSummarySchema>;

export const ValheimContainerListResponseSchema = z.object({
    worldUid: z.string().nullable(),
    capturedAt: z.string().nullable(),
    containers: z.array(ValheimContainerSummarySchema),
    items: z.record(z.string(), ValheimCatalogEntrySchema),
    atlas: ValheimMapBaseMapSchema.nullable(),
}).strict();
export type ValheimContainerListResponse = z.infer<typeof ValheimContainerListResponseSchema>;

export const ValheimContainerDetailSchema = ValheimContainerSummarySchema.extend({
    stacks: z.array(z.object({
        prefab: ValheimPrefabIdSchema,
        quality: z.number().int().min(1).max(10),
        stack: z.number().int().min(0),
    }).strict()),
}).strict();
export type ValheimContainerDetail = z.infer<typeof ValheimContainerDetailSchema>;
