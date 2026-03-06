/**
 * Dungeon quest query helpers.
 * Extracted from dungeon-quests.service.ts for file size compliance (ROK-711).
 */
import { join } from 'path';
import { readFile } from 'fs/promises';
import { Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EnrichedQuestReward } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { wowClassicBossLoot } from '../../drizzle/schema';
import type { DungeonQuestDto } from './dungeon-quests.types';

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
};

/** Map a DB row to a DTO. */
export function toDto(row: typeof schema.wowClassicDungeonQuests.$inferSelect): DungeonQuestDto {
  return {
    questId: row.questId, dungeonInstanceId: row.dungeonInstanceId, name: row.name,
    questLevel: row.questLevel, requiredLevel: row.requiredLevel, expansion: row.expansion,
    questGiverNpc: row.questGiverNpc, questGiverZone: row.questGiverZone,
    prevQuestId: row.prevQuestId, nextQuestId: row.nextQuestId,
    rewardsJson: row.rewardsJson, objectives: row.objectives,
    classRestriction: row.classRestriction, raceRestriction: row.raceRestriction,
    startsInsideDungeon: row.startsInsideDungeon, sharable: row.sharable,
    rewardXp: row.rewardXp, rewardGold: row.rewardGold, rewardType: row.rewardType,
  };
}

/** Walk backwards/forwards through quest chain links in memory. */
export function walkChainInMemory(
  quest: DungeonQuestDto,
  questLookup: Map<number, DungeonQuestDto>,
): DungeonQuestDto[] {
  const chain: DungeonQuestDto[] = [quest];
  const visited = new Set<number>([quest.questId]);

  let currentPrev = quest.prevQuestId;
  while (currentPrev !== null && !visited.has(currentPrev) && visited.size < MAX_CHAIN_DEPTH) {
    const prev = questLookup.get(currentPrev);
    if (!prev) break;
    visited.add(prev.questId);
    chain.unshift(prev);
    currentPrev = prev.prevQuestId;
  }

  let currentNext = quest.nextQuestId;
  while (currentNext !== null && !visited.has(currentNext) && visited.size < MAX_CHAIN_DEPTH) {
    const next = questLookup.get(currentNext);
    if (!next) break;
    visited.add(next.questId);
    chain.push(next);
    currentNext = next.nextQuestId;
  }

  return chain;
}

/** Collect IDs from quest chain links not yet in the lookup. */
export function collectFrontierIds(quests: DungeonQuestDto[], questLookup: Map<number, DungeonQuestDto>): Set<number> {
  const frontier = new Set<number>();
  for (const q of quests) {
    if (q.prevQuestId !== null && !questLookup.has(q.prevQuestId)) frontier.add(q.prevQuestId);
    if (q.nextQuestId !== null && !questLookup.has(q.nextQuestId)) frontier.add(q.nextQuestId);
  }
  return frontier;
}

/** Load quest reward item metadata from Wowhead-enriched JSON file. */
export async function loadRewardItemLookup(): Promise<Record<string, EnrichedQuestReward>> {
  const lookup: Record<string, EnrichedQuestReward> = {};
  try {
    const rewardItemPath = join(__dirname, 'data', 'quest-reward-items.json');
    const rawRewardData = await readFile(rewardItemPath, 'utf-8');
    const parsed = JSON.parse(rawRewardData) as Record<string, {
      name: string; quality: string; slot: string | null;
      itemLevel: number | null; iconUrl: string | null; itemSubclass: string | null;
    }>;
    for (const [idStr, item] of Object.entries(parsed)) {
      lookup[idStr] = {
        itemId: Number(idStr), itemName: item.name, quality: item.quality,
        slot: item.slot, itemLevel: item.itemLevel, iconUrl: item.iconUrl,
        itemSubclass: item.itemSubclass ?? null,
      };
    }
  } catch {
    logger.warn('Could not load quest-reward-items.json — falling back to boss loot table only');
  }
  return lookup;
}

/** Build item details map from Wowhead JSON + boss loot table fallback. */
export async function buildItemDetailsMap(
  db: PostgresJsDatabase<typeof schema>,
  allItemIds: Set<number>,
  rewardItemLookup: Record<string, EnrichedQuestReward>,
): Promise<Map<number, EnrichedQuestReward>> {
  const itemDetailsMap = new Map<number, EnrichedQuestReward>();

  for (const itemId of allItemIds) {
    const wowheadItem = rewardItemLookup[String(itemId)];
    if (wowheadItem) itemDetailsMap.set(itemId, wowheadItem);
  }

  const lootLookupIds = [...allItemIds];
  if (lootLookupIds.length > 0) {
    const lootRows = await db.select({
      itemId: wowClassicBossLoot.itemId, itemName: wowClassicBossLoot.itemName,
      quality: wowClassicBossLoot.quality, slot: wowClassicBossLoot.slot,
      itemLevel: wowClassicBossLoot.itemLevel, iconUrl: wowClassicBossLoot.iconUrl,
      itemSubclass: wowClassicBossLoot.itemSubclass,
    }).from(wowClassicBossLoot).where(inArray(wowClassicBossLoot.itemId, lootLookupIds));

    for (const row of lootRows) {
      const existing = itemDetailsMap.get(row.itemId);
      if (existing) {
        if (!existing.itemSubclass && row.itemSubclass) existing.itemSubclass = row.itemSubclass;
      } else {
        itemDetailsMap.set(row.itemId, { ...row });
      }
    }
  }

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
