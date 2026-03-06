/**
 * Boss data refresh helpers and constants.
 * Extracted from boss-data-refresh.service.ts for file size compliance (ROK-711).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';
import type { BlizzardService } from './blizzard.service';

export const REGION = 'us';
export const NAMESPACE = `static-${REGION}`;
export const BASE_URL = `https://${REGION}.api.blizzard.com`;

/** Blizzard quality type to display name. */
export const QUALITY_MAP: Record<string, string> = {
  POOR: 'Poor', COMMON: 'Common', UNCOMMON: 'Uncommon', RARE: 'Rare', EPIC: 'Epic', LEGENDARY: 'Legendary',
};

/** Blizzard inventory_type to slot display name. */
export const SLOT_MAP: Record<string, string | null> = {
  HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulder', CHEST: 'Chest', WAIST: 'Waist', LEGS: 'Legs',
  FEET: 'Feet', WRIST: 'Wrist', HAND: 'Hands', FINGER: 'Finger', TRINKET: 'Trinket', CLOAK: 'Back',
  WEAPON: 'One-Hand', SHIELD: 'Shield', RANGED: 'Ranged', RANGEDRIGHT: 'Ranged', TWOHWEAPON: 'Two-Hand',
  WEAPONMAINHAND: 'Main Hand', WEAPONOFFHAND: 'Off Hand', HOLDABLE: 'Held In Off-hand', THROWN: 'Ranged', RELIC: 'Relic',
};

/** Expansion name from Blizzard to seed key. */
export const EXPANSION_KEY: Record<string, string> = {
  Classic: 'classic', 'Burning Crusade': 'tbc', 'Wrath of the Lich King': 'wotlk', Cataclysm: 'cata',
};

export interface JournalInstance {
  id: number; name: string; expansion?: { name: string }; encounters?: Array<{ id: number; name: string }>;
}

export interface JournalEncounter {
  items?: Array<{ item: { id: number; name?: string } }>;
}

export interface ItemDetail {
  name?: string; level?: number; quality?: { type: string }; inventory_type?: { type: string }; item_subclass?: { name: string };
}

export interface ItemMedia {
  assets?: Array<{ value: string }>;
}

/** Upsert a single boss encounter. Returns the boss DB ID or null. */
export async function upsertBoss(db: PostgresJsDatabase<typeof schema>, instanceId: number, name: string, order: number, expansion: string): Promise<number | null> {
  const bossRows = await db.insert(wowClassicBosses).values({ instanceId, name, order, expansion, sodModified: false })
    .onConflictDoUpdate({
      target: [wowClassicBosses.instanceId, wowClassicBosses.name, wowClassicBosses.expansion],
      set: { order: sql`excluded.order`, sodModified: sql`excluded.sod_modified` },
    }).returning({ id: wowClassicBosses.id });
  return bossRows[0]?.id ?? null;
}

/** Fetch, process, and upsert a single loot item. Returns true if item was upserted. */
export async function processLootItem(
  db: PostgresJsDatabase<typeof schema>, blizzardService: BlizzardService,
  bossId: number, item: { id: number; name?: string }, expansion: string,
): Promise<boolean> {
  const itemDetail = await blizzardService.fetchBlizzardApi<ItemDetail>(
    `${BASE_URL}/data/wow/item/${item.id}?namespace=${NAMESPACE}&locale=en_US`,
  );
  if (!itemDetail) return false;

  const quality = QUALITY_MAP[itemDetail.quality?.type || ''] || 'Common';
  if (quality === 'Poor' || quality === 'Common') return false;

  const slot = SLOT_MAP[itemDetail.inventory_type?.type || ''] || null;
  const media = await blizzardService.fetchBlizzardApi<ItemMedia>(
    `${BASE_URL}/data/wow/media/item/${item.id}?namespace=${NAMESPACE}&locale=en_US`,
  );

  await db.insert(wowClassicBossLoot).values({
    bossId, itemId: item.id, itemName: item.name || itemDetail.name || `Item ${item.id}`,
    slot, quality, itemLevel: itemDetail.level || null, dropRate: null, expansion,
    classRestrictions: null, iconUrl: media?.assets?.[0]?.value || null,
    itemSubclass: itemDetail.item_subclass?.name || null,
  }).onConflictDoUpdate({
    target: [wowClassicBossLoot.bossId, wowClassicBossLoot.itemId, wowClassicBossLoot.expansion],
    set: { itemName: sql`excluded.item_name`, slot: sql`excluded.slot`, quality: sql`excluded.quality`,
      itemLevel: sql`excluded.item_level`, iconUrl: sql`excluded.icon_url`, itemSubclass: sql`excluded.item_subclass` },
  });
  return true;
}
