import { z } from 'zod';
import {
    VALHEIM_LINK_EQUIPMENT_MAX,
    VALHEIM_LINK_GRID_EDGE_MAX,
    VALHEIM_LINK_INVENTORY_ITEMS_MAX,
    VALHEIM_LINK_KNOWN_MAX,
    VALHEIM_LINK_SKILLS_MAX,
    VALHEIM_LINK_TROPHIES_MAX,
    ValheimInt64StringSchema,
    ValheimPrefabIdSchema,
    ValheimSteamId64Schema,
    valheimLinkHeaderShape,
} from './valheim-link-common.schema.js';

// ============================================================
// RL Valheim Link — `kind: "character"` summary (ROK-1829)
// Sent on every vanilla save broadcast, on logout and on quit.
// ============================================================

/** Who the character is, and on which world it was captured. */
export const ValheimCharacterIdentitySchema = z.object({
    steamId: ValheimSteamId64Schema,
    /** Valheim `Player.GetPlayerID()` — the key; names are free text. */
    playerId: ValheimInt64StringSchema,
    name: z.string().min(1).max(32),
    /** `ZNet.GetWorldUID()`; opaque to Raid Ledger. */
    worldUid: ValheimInt64StringSchema,
    /** World name as the server reports it; opaque, display only. */
    worldName: z.string().min(1).max(64),
}).strict();
export type ValheimCharacterIdentity = z.infer<typeof ValheimCharacterIdentitySchema>;

/** One item stack, as `ItemDrop.ItemData` holds it. */
export const ValheimItemStackSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    stack: z.number().int().min(1).max(100_000),
    /** Upgrade level, 1-based (vanilla max 4; mods go higher). */
    quality: z.number().int().min(1).max(10),
    /** Style variant index (`m_variant`), 0 when the item has one look. */
    variant: z.number().int().min(0).max(63),
    /** Current durability points; null when the item has no durability. */
    durability: z.number().nonnegative().max(1_000_000).nullable(),
    /** Max durability at this quality; null exactly when `durability` is. */
    maxDurability: z.number().nonnegative().max(1_000_000).nullable(),
}).strict().refine((s) => (s.durability === null) === (s.maxDurability === null), {
    path: ['maxDurability'],
    message: 'durability and maxDurability are null together',
});
export type ValheimItemStack = z.infer<typeof ValheimItemStackSchema>;

/** Equip slots. Adding a value is additive (server ships first). */
export const ValheimEquipSlotSchema = z.enum([
    'head', 'chest', 'legs', 'shoulder', 'utility', 'trinket',
    'rightHand', 'leftHand', 'ammo',
]);
export type ValheimEquipSlot = z.infer<typeof ValheimEquipSlotSchema>;

export const ValheimEquippedItemSchema = z.object({
    slot: ValheimEquipSlotSchema,
    item: ValheimItemStackSchema,
}).strict();

/** What a non-main inventory row holds (EAQS / Extended Player Inventory). */
export const ValheimGridRowPurposeSchema = z.enum([
    'equipment', 'quickslot', 'extended', 'other',
]);

export const ValheimGridExtraRowSchema = z.object({
    /** 0-based row index inside the grid, `y < grid.height`. */
    y: z.number().int().min(0).max(VALHEIM_LINK_GRID_EDGE_MAX - 1),
    purpose: ValheimGridRowPurposeSchema,
}).strict();

/**
 * The player inventory grid. Vanilla is 8×4; inventory mods add rows, so
 * the size is explicit and every row past the vanilla four is listed in
 * `extraRows` with what it holds.
 */
export const ValheimInventoryGridSchema = z.object({
    width: z.number().int().min(1).max(VALHEIM_LINK_GRID_EDGE_MAX),
    height: z.number().int().min(1).max(VALHEIM_LINK_GRID_EDGE_MAX),
    extraRows: z.array(ValheimGridExtraRowSchema).max(VALHEIM_LINK_GRID_EDGE_MAX),
}).strict();

export const ValheimInventorySlotSchema = z.object({
    x: z.number().int().min(0).max(VALHEIM_LINK_GRID_EDGE_MAX - 1),
    y: z.number().int().min(0).max(VALHEIM_LINK_GRID_EDGE_MAX - 1),
    /** True when this stack is also listed in `equipment`. */
    equipped: z.boolean(),
    item: ValheimItemStackSchema,
}).strict();

export const ValheimInventorySchema = z.object({
    grid: ValheimInventoryGridSchema,
    items: z.array(ValheimInventorySlotSchema).max(VALHEIM_LINK_INVENTORY_ITEMS_MAX),
}).strict().superRefine((inv, ctx) => {
    const seen = new Set<string>();
    inv.items.forEach((slot, i) => {
        const key = `${slot.x},${slot.y}`;
        if (slot.x >= inv.grid.width || slot.y >= inv.grid.height) {
            ctx.addIssue({ code: 'custom', path: ['items', i], message: 'slot outside grid' });
        } else if (seen.has(key)) {
            ctx.addIssue({ code: 'custom', path: ['items', i], message: 'duplicate slot' });
        }
        seen.add(key);
    });
    inv.grid.extraRows.forEach((row, i) => {
        if (row.y >= inv.grid.height) {
            ctx.addIssue({ code: 'custom', path: ['grid', 'extraRows', i], message: 'row outside grid' });
        }
    });
});
export type ValheimInventory = z.infer<typeof ValheimInventorySchema>;

/**
 * One skill. `id` is `Skills.SkillType.ToString()`: a name for vanilla
 * skills (`Swords`), a signed integer string for a modded skill.
 */
export const ValheimSkillSchema = z.object({
    id: z.string().regex(/^-?[A-Za-z0-9_]{1,64}$/),
    /** `m_level`, 0–100, fractional. */
    level: z.number().min(0).max(100),
    /** `m_accumulator`: progress toward the next level, game units. */
    accumulator: z.number().nonnegative().max(1_000_000),
}).strict();
export type ValheimSkill = z.infer<typeof ValheimSkillSchema>;

const prefabList = (max: number) => z.array(ValheimPrefabIdSchema).max(max);

function uniqueBy<T>(
    list: readonly T[],
    key: (v: T) => string,
    path: string,
    ctx: z.RefinementCtx,
): void {
    const seen = new Set<string>();
    list.forEach((v, i) => {
        const k = key(v);
        if (seen.has(k)) ctx.addIssue({ code: 'custom', path: [path, i], message: `duplicate ${path} entry` });
        seen.add(k);
    });
}

export const ValheimCharacterMessageSchema = z.object({
    ...valheimLinkHeaderShape,
    kind: z.literal('character'),
    character: ValheimCharacterIdentitySchema,
    equipment: z.array(ValheimEquippedItemSchema).max(VALHEIM_LINK_EQUIPMENT_MAX),
    inventory: ValheimInventorySchema,
    skills: z.array(ValheimSkillSchema).max(VALHEIM_LINK_SKILLS_MAX),
    /** Trophy prefab ids the player has collected (`m_trophies`). */
    trophies: prefabList(VALHEIM_LINK_TROPHIES_MAX),
    /** Prefab ids the player has discovered (`m_knownMaterial`). */
    knownItems: prefabList(VALHEIM_LINK_KNOWN_MAX),
    /** Recipe item prefab ids the player can craft (`m_knownRecipes`). */
    knownRecipes: prefabList(VALHEIM_LINK_KNOWN_MAX),
}).strict().superRefine((msg, ctx) => {
    uniqueBy(msg.equipment, (e) => e.slot, 'equipment', ctx);
    uniqueBy(msg.skills, (s) => s.id, 'skills', ctx);
});
export type ValheimCharacterMessage = z.infer<typeof ValheimCharacterMessageSchema>;
