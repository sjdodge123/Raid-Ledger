import { z } from 'zod';

/**
 * ROK-2176: a WoW item's full tooltip, parsed server-side from Wowhead's
 * tooltip endpoint and cached on `wow_item_meta`. Attached at read time to
 * boss loot (`BossLootDto.tooltip`) and Armory/addon gear
 * (`EquipmentItem.tooltip`) so the web can render a full-stat popup and diff
 * a drop against the equipped item.
 */

/** One numeric stat line: a primary stat, a resistance or a parsed equip effect. */
export const ItemTooltipStatSchema = z.object({
    /** Canonical UPPER_SNAKE key derived from the name: STAMINA, FIRE_RESISTANCE, ATTACK_POWER. */
    key: z.string(),
    /** Display name: "Stamina", "Fire Resistance", "Attack Power". */
    name: z.string(),
    /** Signed value; percent effects are stored as the number (1 = 1%). */
    value: z.number(),
    unit: z.enum(['flat', 'percent']).optional(),
});
export type ItemTooltipStat = z.infer<typeof ItemTooltipStatSchema>;

/** Weapon damage line of a tooltip. */
const ItemTooltipWeaponSchema = z.object({
    damageMin: z.number(),
    damageMax: z.number(),
    attackSpeed: z.number(),
    dps: z.number(),
});

/** Parsed Wowhead tooltip for one item. */
export const ItemTooltipSchema = z.object({
    /** Wowhead dataEnv the tooltip came from: 16 (Forever) or 4 (Classic). */
    env: z.union([z.literal(16), z.literal(4)]),
    /** "Two-Hand", "Finger", "Legs". */
    slotLabel: z.string().nullable(),
    /** "Mace", "Cloth"; null when empty (rings). */
    subclass: z.string().nullable(),
    /** "Binds when picked up". */
    binding: z.string().nullable(),
    unique: z.boolean(),
    requiredLevel: z.number().int().nullable(),
    armor: z.number().int().nullable(),
    weapon: ItemTooltipWeaponSchema.nullable(),
    /** Primary stats + resistances + parsed equip effects. */
    stats: z.array(ItemTooltipStatSchema),
    /** Every Equip:/Use:/Chance on hit: line as plain text (shown, not diffed unless parsed into stats). */
    effects: z.array(z.string()),
    setName: z.string().nullable(),
    /** "<Random enchantment>" — base stats unknown. */
    randomEnchant: z.boolean(),
});
export type ItemTooltip = z.infer<typeof ItemTooltipSchema>;
