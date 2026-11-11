/**
 * Dungeon quest query helpers.
 * Extracted from dungeon-quests.service.ts for file size compliance (ROK-711).
 */
import { join } from 'path';
import { readFile } from 'fs/promises';
import { Logger } from '@nestjs/common';
import { and, inArray, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EnrichedQuestReward } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { wowClassicBossLoot } from '../../drizzle/schema';
import type { DungeonQuestDto } from './dungeon-quests.types';
import { mergeItemMetaFallback } from './dungeon-quests.item-meta';

const logger = new Logger('DungeonQuestsHelpers');

/** Safety limit for chain walking to prevent infinite loops from circular data. */
export const MAX_CHAIN_DEPTH = 50;

/**
 * Variant-to-expansion-set mapping.
 * Each variant includes quests from all expansions up to and including its era.
 */
export const VARIANT_EXPANSIONS: Record<string, string[]> = {
  classic_era: ['classic'],
  classic_era_sod: ['classic', 'sod'],
  classic_anniversary: ['classic', 'tbc'],
  classic: ['classic', 'tbc', 'wotlk', 'cata'],
  retail: ['classic', 'tbc', 'wotlk', 'cata'],
  // ROK-1719/1748: vanilla content plus Forever's own seeded 'forever' rows.
  wow_forever: ['classic', 'forever'],
};

/** Map a DB row to a DTO. */
export function toDto(
  row: typeof schema.wowClassicDungeonQuests.$inferSelect,
): DungeonQuestDto {
  return {
    questId: row.questId,
    dungeonInstanceId: row.dungeonInstanceId,
    name: row.name,
    questLevel: row.questLevel,
    requiredLevel: row.requiredLevel,
    expansion: row.expansion,
    questGiverNpc: row.questGiverNpc,
    questGiverZone: row.questGiverZone,
    prevQuestId: row.prevQuestId,
    nextQuestId: row.nextQuestId,
    rewardsJson: row.rewardsJson,
    objectives: row.objectives,
    classRestriction: row.classRestriction,
    raceRestriction: row.raceRestriction,
    startsInsideDungeon: row.startsInsideDungeon,
    sharable: row.sharable,
    rewardXp: row.rewardXp,
    rewardGold: row.rewardGold,
    rewardType: row.rewardType,
  };
}

/** Walk backwards through chain links, prepending to the chain. */
function walkBackward(
  quest: DungeonQuestDto,
  questLookup: Map<number, DungeonQuestDto>,
  chain: DungeonQuestDto[],
  visited: Set<number>,
): void {
  let cur = quest.prevQuestId;
  while (cur !== null && !visited.has(cur) && visited.size < MAX_CHAIN_DEPTH) {
    const prev = questLookup.get(cur);
    if (!prev) break;
    visited.add(prev.questId);
    chain.unshift(prev);
    cur = prev.prevQuestId;
  }
}

/** Walk forwards through chain links, appending to the chain. */
function walkForward(
  quest: DungeonQuestDto,
  questLookup: Map<number, DungeonQuestDto>,
  chain: DungeonQuestDto[],
  visited: Set<number>,
): void {
  let cur = quest.nextQuestId;
  while (cur !== null && !visited.has(cur) && visited.size < MAX_CHAIN_DEPTH) {
    const next = questLookup.get(cur);
    if (!next) break;
    visited.add(next.questId);
    chain.push(next);
    cur = next.nextQuestId;
  }
}

/** Walk backwards/forwards through quest chain links in memory. */
export function walkChainInMemory(
  quest: DungeonQuestDto,
  questLookup: Map<number, DungeonQuestDto>,
): DungeonQuestDto[] {
  const chain: DungeonQuestDto[] = [quest];
  const visited = new Set<number>([quest.questId]);
  walkBackward(quest, questLookup, chain, visited);
  walkForward(quest, questLookup, chain, visited);
  return chain;
}

/**
 * ROK-2143: a quest's prerequisite chain, or null when the backward walk
 * found no other quest before it (no `prevQuestId`, or one that is not in
 * our data) — so a quest never shows up as its own prerequisite.
 */
export function prerequisiteChainOf(
  quest: DungeonQuestDto,
  questLookup: Map<number, DungeonQuestDto>,
): DungeonQuestDto[] | null {
  const chain = walkChainInMemory(quest, questLookup);
  return chain[0]?.questId === quest.questId ? null : chain;
}

/** Collect IDs from quest chain links not yet in the lookup. */
export function collectFrontierIds(
  quests: DungeonQuestDto[],
  questLookup: Map<number, DungeonQuestDto>,
): Set<number> {
  const frontier = new Set<number>();
  for (const q of quests) {
    if (q.prevQuestId !== null && !questLookup.has(q.prevQuestId))
      frontier.add(q.prevQuestId);
    if (q.nextQuestId !== null && !questLookup.has(q.nextQuestId))
      frontier.add(q.nextQuestId);
  }
  return frontier;
}

/** Parse raw reward item JSON into enriched lookup. */
function parseRewardItems(
  parsed: Record<
    string,
    {
      name: string;
      quality: string;
      slot: string | null;
      itemLevel: number | null;
      iconUrl: string | null;
      itemSubclass: string | null;
    }
  >,
): Record<string, EnrichedQuestReward> {
  const lookup: Record<string, EnrichedQuestReward> = {};
  for (const [idStr, item] of Object.entries(parsed)) {
    lookup[idStr] = {
      itemId: Number(idStr),
      itemName: item.name,
      quality: item.quality,
      slot: item.slot,
      itemLevel: item.itemLevel,
      iconUrl: item.iconUrl,
      itemSubclass: item.itemSubclass ?? null,
    };
  }
  return lookup;
}

/** Load quest reward item metadata from Wowhead-enriched JSON file. */
export async function loadRewardItemLookup(): Promise<
  Record<string, EnrichedQuestReward>
> {
  try {
    const rawRewardData = await readFile(
      join(__dirname, 'data', 'quest-reward-items.json'),
      'utf-8',
    );
    return parseRewardItems(
      JSON.parse(rawRewardData) as Record<
        string,
        {
          name: string;
          quality: string;
          slot: string | null;
          itemLevel: number | null;
          iconUrl: string | null;
          itemSubclass: string | null;
        }
      >,
    );
  } catch {
    logger.warn(
      'Could not load quest-reward-items.json — falling back to boss loot table only',
    );
    return {};
  }
}

type LootRewardRow = EnrichedQuestReward & { expansion: string };

/**
 * ROK-2170: one loot row per item id. Classic variants drop `forever` rows;
 * under Forever a `forever` row wins over any other row, whatever DB order.
 */
export function pickLootRows(
  rows: LootRewardRow[],
  preferForever: boolean,
): EnrichedQuestReward[] {
  const picked = new Map<number, LootRewardRow>();
  for (const row of rows) {
    const isForever = row.expansion === 'forever';
    if (isForever && !preferForever) continue;
    const held = picked.get(row.itemId);
    if (!held || (isForever && held.expansion !== 'forever')) {
      picked.set(row.itemId, row);
    }
  }
  return [...picked.values()].map((row) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    quality: row.quality,
    slot: row.slot,
    itemLevel: row.itemLevel,
    iconUrl: row.iconUrl,
    itemSubclass: row.itemSubclass,
  }));
}

/** Merge loot table rows into the item details map, filling gaps. */
function mergeLootRows(
  lootRows: EnrichedQuestReward[],
  map: Map<number, EnrichedQuestReward>,
): void {
  for (const row of lootRows) {
    const existing = map.get(row.itemId);
    if (existing) {
      if (!existing.itemSubclass && row.itemSubclass)
        existing.itemSubclass = row.itemSubclass;
    } else map.set(row.itemId, { ...row });
  }
}

/** Boss-loot rows for the reward ids; Forever rows only when preferred. */
async function selectLootRows(
  db: PostgresJsDatabase<typeof schema>,
  itemIds: number[],
  preferForever: boolean,
): Promise<LootRewardRow[]> {
  const t = wowClassicBossLoot;
  return db
    .select({
      itemId: t.itemId,
      itemName: t.itemName,
      quality: t.quality,
      slot: t.slot,
      itemLevel: t.itemLevel,
      iconUrl: t.iconUrl,
      itemSubclass: t.itemSubclass,
      expansion: t.expansion,
    })
    .from(t)
    .where(
      preferForever
        ? inArray(t.itemId, itemIds)
        : and(inArray(t.itemId, itemIds), ne(t.expansion, 'forever')),
    );
}

/**
 * Build item details map from Wowhead JSON, then the boss loot table, then
 * the `wow_item_meta` cache for ids still unresolved (Forever rewards).
 * `preferForever`: the variant reads Forever data (ROK-2170).
 */
export async function buildItemDetailsMap(
  db: PostgresJsDatabase<typeof schema>,
  allItemIds: Set<number>,
  rewardItemLookup: Record<string, EnrichedQuestReward>,
  preferForever: boolean,
): Promise<Map<number, EnrichedQuestReward>> {
  const itemDetailsMap = new Map<number, EnrichedQuestReward>();
  for (const itemId of allItemIds) {
    const wowheadItem = rewardItemLookup[String(itemId)];
    if (wowheadItem) itemDetailsMap.set(itemId, wowheadItem);
  }
  const lootLookupIds = [...allItemIds];
  if (lootLookupIds.length > 0) {
    const rows = await selectLootRows(db, lootLookupIds, preferForever);
    mergeLootRows(pickLootRows(rows, preferForever), itemDetailsMap);
  }
  await mergeItemMetaFallback(db, allItemIds, itemDetailsMap);
  return itemDetailsMap;
}

/** Collect all reward item IDs across quests. */
export function collectAllItemIds(quests: DungeonQuestDto[]): Set<number> {
  const allItemIds = new Set<number>();
  for (const quest of quests) {
    if (quest.rewardsJson) {
      for (const itemId of quest.rewardsJson) allItemIds.add(itemId);
    }
  }
  return allItemIds;
}
