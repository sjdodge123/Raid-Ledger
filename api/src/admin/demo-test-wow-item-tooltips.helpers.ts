/**
 * ROK-2176 — `POST /admin/test/wow/seed-item-tooltips`: a deterministic
 * Wowhead tooltip cache for the boss-loot compare popup smoke + fleet plan.
 *
 * - `items[]` upserts one fresh `wow_item_meta` row per item (found, current
 *   `tooltip_version`, re-probe 30 days out), so no read ever calls Wowhead
 *   for it. `tooltip: null` is a found item with no parsed stats ("stats not
 *   synced"). An item left out of `items` simply has no row.
 * - `characterId` + `equipment[]` give that character Armory-shaped stored gear
 *   (`characters.equipment`, no `source` key ⇒ Armory), e.g. FINGER_1/FINGER_2,
 *   MAIN_HAND, OFF_HAND, LEGS. Tooltips are never stored on it; the character
 *   read attaches them from `wow_item_meta`.
 * - `gameVariant` (with `characterId`) stamps the character's variant: the
 *   create API leaves it null, and Armory gear is only decorated for
 *   vanilla-era variants (`wow_forever`, `classic_era`).
 */
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import {
  CharacterEquipmentSchema,
  ItemTooltipSchema,
  WowGameVariantSchema,
  type CharacterEquipmentDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { RESOLVED_TTL_MS } from '../plugins/wow-common/wowhead-item/wow-item-meta.resolve';
import { WOWHEAD_TOOLTIP_PARSE_VERSION } from '../plugins/wow-common/wowhead-item/wowhead-item.types';

type Db = PostgresJsDatabase<typeof schema>;

const SeedTooltipItemSchema = z
  .object({
    itemId: z.number().int().positive(),
    name: z.string().min(1).max(255).optional(),
    /** Wowhead quality id 0-7. */
    quality: z.number().int().min(0).max(7).optional(),
    icon: z
      .string()
      .max(100)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
    /** `null` = found, but no parsed stats. */
    tooltip: ItemTooltipSchema.nullable(),
  })
  .strict();
export type SeedTooltipItem = z.infer<typeof SeedTooltipItemSchema>;

const SeedEquipmentItemSchema = z
  .object({
    /** Blizzard slot type: FINGER_1, MAIN_HAND, OFF_HAND, LEGS, … */
    slot: z
      .string()
      .max(32)
      .regex(/^[A-Z][A-Z0-9_]*$/),
    itemId: z.number().int().positive(),
    name: z.string().min(1).max(255),
    /** Blizzard quality type: EPIC, RARE, … */
    quality: z.string().min(1).max(32),
    itemLevel: z.number().int().min(1).max(1000),
  })
  .strict();
export type SeedEquipmentItem = z.infer<typeof SeedEquipmentItemSchema>;

export const SeedItemTooltipsSchema = z
  .object({
    items: z.array(SeedTooltipItemSchema).min(1).max(50).optional(),
    characterId: z.string().uuid().optional(),
    equipment: z.array(SeedEquipmentItemSchema).min(1).max(19).optional(),
    gameVariant: WowGameVariantSchema.optional(),
  })
  .strict()
  .refine(
    (b) => (b.characterId === undefined) === (b.equipment === undefined),
    {
      message: 'characterId and equipment go together',
    },
  )
  .refine((b) => b.items !== undefined || b.equipment !== undefined, {
    message: 'items or equipment is required',
  })
  .refine((b) => b.gameVariant === undefined || b.characterId !== undefined, {
    message: 'gameVariant needs a characterId',
  });
export type SeedItemTooltipsInput = z.infer<typeof SeedItemTooltipsSchema>;

/** One fresh, found `wow_item_meta` row for a seeded item. */
export function seedMetaRow(
  item: SeedTooltipItem,
  now: Date,
): typeof schema.wowItemMeta.$inferInsert {
  const env = item.tooltip?.env ?? 16;
  return {
    itemId: item.itemId,
    status: env === 16 ? 'resolved' : 'classic_fallback',
    env,
    name: item.name ?? null,
    quality: item.quality ?? null,
    icon: item.icon ?? null,
    fetchedAt: now,
    nextRetryAt: new Date(now.getTime() + RESOLVED_TTL_MS),
    attempts: 0,
    tooltip: item.tooltip,
    tooltipVersion: WOWHEAD_TOOLTIP_PARSE_VERSION,
  };
}

/** Armory-shaped stored gear (no `source` ⇒ Armory, no tooltips). */
export function seedArmoryEquipment(
  items: readonly SeedEquipmentItem[],
  now: Date,
): CharacterEquipmentDto {
  const total = items.reduce((sum, i) => sum + i.itemLevel, 0);
  return CharacterEquipmentSchema.parse({
    equippedItemLevel:
      items.length > 0 ? Math.round(total / items.length) : null,
    syncedAt: now.toISOString(),
    items: items.map((i) => ({
      slot: i.slot,
      name: i.name,
      itemId: i.itemId,
      quality: i.quality,
      itemLevel: i.itemLevel,
      itemSubclass: null,
    })),
  });
}

async function upsertMeta(db: Db, row: typeof schema.wowItemMeta.$inferInsert) {
  const { itemId, ...rest } = row;
  await db
    .insert(schema.wowItemMeta)
    .values(row)
    .onConflictDoUpdate({ target: schema.wowItemMeta.itemId, set: rest });
  return itemId;
}

async function writeEquipment(
  db: Db,
  characterId: string,
  equipment: CharacterEquipmentDto,
  gameVariant: string | undefined,
): Promise<void> {
  const updated = await db
    .update(schema.characters)
    .set(gameVariant === undefined ? { equipment } : { equipment, gameVariant })
    .where(eq(schema.characters.id, characterId))
    .returning({ id: schema.characters.id });
  if (updated.length === 0)
    throw new NotFoundException(`character ${characterId} not found`);
}

export interface SeedItemTooltipsResult {
  itemIds: number[];
  characterId: string | null;
  equipment: CharacterEquipmentDto | null;
}

/** Upsert the meta rows, then (optionally) the character's stored gear. */
export async function seedItemTooltips(
  db: Db,
  input: SeedItemTooltipsInput,
  now: Date = new Date(),
): Promise<SeedItemTooltipsResult> {
  const itemIds: number[] = [];
  for (const item of input.items ?? []) {
    itemIds.push(await upsertMeta(db, seedMetaRow(item, now)));
  }
  if (input.characterId === undefined || input.equipment === undefined) {
    return { itemIds, characterId: null, equipment: null };
  }
  const equipment = seedArmoryEquipment(input.equipment, now);
  await writeEquipment(db, input.characterId, equipment, input.gameVariant);
  return { itemIds, characterId: input.characterId, equipment };
}
