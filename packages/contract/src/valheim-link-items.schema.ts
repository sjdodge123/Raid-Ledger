import { z } from 'zod';
import {
    VALHEIM_LINK_ITEM_EXPORT_MAX,
    ValheimBinaryRefSchema,
    ValheimPrefabIdSchema,
    valheimLinkHeaderShape,
} from './valheim-link-common.schema.js';

// ============================================================
// RL Valheim Link — `kind: "items"` catalogue export (ROK-1829)
// Once per game version (and whenever the server's mod set changes): every
// ObjectDB item with its display name, category and icon. Names and icons
// come from the mod's export (operator ruling), so modded items work.
// CONTRACT.md §5.
// ============================================================

/**
 * `ItemDrop.ItemData.ItemType.ToString()` — `Material`, `OneHandedWeapon`,
 * `Helmet`, `Trophy`… Open set (mods may add types).
 */
export const ValheimItemCategorySchema = z.string().regex(/^[A-Za-z0-9_]{1,48}$/);

/** A sprite rectangle inside the icon atlas, in atlas pixels, top-left origin. */
export const ValheimAtlasIconSchema = z.object({
    kind: z.literal('atlas'),
    x: z.number().int().min(0).max(16_383),
    y: z.number().int().min(0).max(16_383),
    w: z.number().int().min(1).max(512),
    h: z.number().int().min(1).max(512),
}).strict();

/** A separately uploaded PNG, by file name (`<prefab>.png` by convention). */
export const ValheimFileIconSchema = z.object({
    kind: z.literal('file'),
    file: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\.png$/),
}).strict();

export const ValheimItemIconSchema = z.discriminatedUnion('kind', [
    ValheimAtlasIconSchema,
    ValheimFileIconSchema,
]);
export type ValheimItemIcon = z.infer<typeof ValheimItemIconSchema>;

export const ValheimItemDefinitionSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    /** Localised display name in the message `locale` (`Iron sword`). */
    name: z.string().min(1).max(96),
    category: ValheimItemCategorySchema,
    /** `m_maxStackSize`. */
    maxStack: z.number().int().min(1).max(100_000),
    /** `m_maxQuality`. */
    maxQuality: z.number().int().min(1).max(10),
    /** Number of style variants (`m_variants`), 0 when none. */
    variants: z.number().int().min(0).max(64),
    /** Icon for variant 0; null when the item has no icon sprite. */
    icon: ValheimItemIconSchema.nullable(),
}).strict();
export type ValheimItemDefinition = z.infer<typeof ValheimItemDefinitionSchema>;

export const ValheimItemsMessageSchema = z.object({
    ...valheimLinkHeaderShape,
    kind: z.literal('items'),
    /** Unity / Valheim language the names were exported in, e.g. `English`. */
    locale: z.string().regex(/^[A-Za-z_-]{2,32}$/),
    /**
     * The icon atlas PNG, uploaded separately. Required when any item uses
     * an `atlas` icon; null when every icon is a `file` or null.
     */
    atlas: ValheimBinaryRefSchema.nullable(),
    items: z.array(ValheimItemDefinitionSchema).min(1).max(VALHEIM_LINK_ITEM_EXPORT_MAX),
}).strict().superRefine((msg, ctx) => {
    const seen = new Set<string>();
    msg.items.forEach((item, i) => {
        if (seen.has(item.prefab)) {
            ctx.addIssue({ code: 'custom', path: ['items', i, 'prefab'], message: 'duplicate prefab' });
        }
        seen.add(item.prefab);
        const icon = item.icon;
        if (icon?.kind !== 'atlas' || !msg.atlas) return;
        if (icon.x + icon.w > msg.atlas.width || icon.y + icon.h > msg.atlas.height) {
            ctx.addIssue({ code: 'custom', path: ['items', i, 'icon'], message: 'icon outside atlas' });
        }
    });
    if (!msg.atlas && msg.items.some((item) => item.icon?.kind === 'atlas')) {
        ctx.addIssue({ code: 'custom', path: ['atlas'], message: 'atlas icon without an atlas' });
    }
});
export type ValheimItemsMessage = z.infer<typeof ValheimItemsMessageSchema>;
