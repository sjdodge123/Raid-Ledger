import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray, and } from 'drizzle-orm';
import { join } from 'path';
import { readFile } from 'fs/promises';

import * as schema from '../../drizzle/schema';
import {
  wowClassicDungeonQuests,
  wowClassicBossLoot,
} from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DungeonQuestSeeder } from './dungeon-quest-seeder';

/**
 * Variant-to-expansion-set mapping.
 * Each variant includes quests from all expansions up to and including its era.
 */
const VARIANT_EXPANSIONS: Record<string, string[]> = {
  classic_era: ['classic'],
  classic_anniversary: ['classic', 'tbc'],
  classic: ['classic', 'tbc', 'wotlk', 'cata'],
  retail: ['classic', 'tbc', 'wotlk', 'cata'],
};

export interface DungeonQuestDto {
  questId: number;
  dungeonInstanceId: number | null;
  name: string;
  questLevel: number | null;
  requiredLevel: number | null;
  expansion: string;
  questGiverNpc: string | null;
  questGiverZone: string | null;
  prevQuestId: number | null;
  nextQuestId: number | null;
  rewardsJson: number[] | null;
  objectives: string | null;
  classRestriction: string[] | null;
  raceRestriction: string[] | null;
  startsInsideDungeon: boolean;
  sharable: boolean;
  rewardXp: number | null;
  rewardGold: number | null;
  rewardType: string | null;
}

export interface EnrichedQuestReward {
  itemId: number;
  itemName: string;
  quality: string;
  slot: string | null;
  itemLevel: number | null;
  iconUrl: string | null;
}

export interface EnrichedDungeonQuestDto extends DungeonQuestDto {
  rewards: EnrichedQuestReward[] | null;
  prerequisiteChain: DungeonQuestDto[] | null;
}

/**
 * Service for querying dungeon quest data with variant-aware filtering.
 *
 * ROK-245: Variant-Aware Dungeon Quest Database
 */
@Injectable()
export class DungeonQuestsService {
  private readonly logger = new Logger(DungeonQuestsService.name);
  /** Safety limit for chain walking to prevent infinite loops from circular data */
  private static readonly MAX_CHAIN_DEPTH = 50;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly seeder: DungeonQuestSeeder,
  ) {}

  /**
   * Get the expansion set for a given WoW game variant.
   */
  getExpansionsForVariant(variant: string): string[] {
    return VARIANT_EXPANSIONS[variant] ?? VARIANT_EXPANSIONS['classic_era'];
  }

  /**
   * Get all quests for a dungeon instance, filtered by variant.
   * Synthetic sub-instance IDs (>10000, e.g. SM:Armory = 31603) also match
   * their parent instance (316 = Scarlet Monastery) so complex-wide quests
   * appear regardless of which wing is selected.
   */
  async getQuestsForInstance(
    instanceId: number,
    variant: string = 'classic_era',
  ): Promise<DungeonQuestDto[]> {
    const expansions = this.getExpansionsForVariant(variant);

    // Resolve synthetic sub-instance IDs to also include the parent
    const instanceIds = [instanceId];
    if (instanceId > 10000) {
      instanceIds.push(Math.floor(instanceId / 100));
    }

    const rows = await this.db
      .select()
      .from(wowClassicDungeonQuests)
      .where(
        and(
          inArray(wowClassicDungeonQuests.dungeonInstanceId, instanceIds),
          inArray(wowClassicDungeonQuests.expansion, expansions),
        ),
      )
      .orderBy(wowClassicDungeonQuests.questLevel);

    return rows.map((row) => this.toDto(row));
  }

  /**
   * Get the full prerequisite chain for a quest.
   * Walks backwards through prevQuestId and forwards through nextQuestId.
   */
  async getQuestChain(questId: number): Promise<DungeonQuestDto[]> {
    // First, find the quest itself
    const [quest] = await this.db
      .select()
      .from(wowClassicDungeonQuests)
      .where(eq(wowClassicDungeonQuests.questId, questId))
      .limit(1);

    if (!quest) return [];

    const chain: (typeof quest)[] = [quest];
    const visited = new Set<number>([questId]);

    // Walk backwards — find all prev quests
    let currentPrev = quest.prevQuestId;
    while (
      currentPrev !== null &&
      !visited.has(currentPrev) &&
      visited.size < DungeonQuestsService.MAX_CHAIN_DEPTH
    ) {
      const [prev] = await this.db
        .select()
        .from(wowClassicDungeonQuests)
        .where(eq(wowClassicDungeonQuests.questId, currentPrev))
        .limit(1);
      if (!prev) break;
      visited.add(prev.questId);
      chain.unshift(prev);
      currentPrev = prev.prevQuestId;
    }

    // Walk forwards — find all next quests
    let currentNext = quest.nextQuestId;
    while (
      currentNext !== null &&
      !visited.has(currentNext) &&
      visited.size < DungeonQuestsService.MAX_CHAIN_DEPTH
    ) {
      const [next] = await this.db
        .select()
        .from(wowClassicDungeonQuests)
        .where(eq(wowClassicDungeonQuests.questId, currentNext))
        .limit(1);
      if (!next) break;
      visited.add(next.questId);
      chain.push(next);
      currentNext = next.nextQuestId;
    }

    return chain.map((row) => this.toDto(row));
  }

  /**
   * Map a DB row to a DTO.
   */
  private toDto(
    row: typeof wowClassicDungeonQuests.$inferSelect,
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

  /**
   * Seed quest data (delegates to seeder).
   */
  async seedQuests(): Promise<{ inserted: number; total: number }> {
    return this.seeder.seed();
  }

  /**
   * Drop all quest data (delegates to seeder).
   */
  async dropQuests(): Promise<void> {
    return this.seeder.drop();
  }

  /**
   * Get enriched quests for an instance — includes resolved reward item details
   * and prerequisite chains.
   *
   * ROK-246: Dungeon Companion — Quest Suggestions UI
   */
  async getEnrichedQuestsForInstance(
    instanceId: number,
    variant: string = 'classic_era',
  ): Promise<EnrichedDungeonQuestDto[]> {
    const quests = await this.getQuestsForInstance(instanceId, variant);

    // Collect all reward item IDs across all quests
    const allItemIds = new Set<number>();
    for (const quest of quests) {
      if (quest.rewardsJson) {
        for (const itemId of quest.rewardsJson) {
          allItemIds.add(itemId);
        }
      }
    }

    // Load quest reward item metadata from Wowhead-enriched JSON file
    const rewardItemLookup: Record<string, EnrichedQuestReward> = {};
    try {
      const rewardItemPath = join(__dirname, 'data', 'quest-reward-items.json');
      const rawRewardData = await readFile(rewardItemPath, 'utf-8');
      const parsed = JSON.parse(rawRewardData) as Record<
        string,
        {
          name: string;
          quality: string;
          slot: string | null;
          itemLevel: number | null;
          iconUrl: string | null;
        }
      >;
      for (const [idStr, item] of Object.entries(parsed)) {
        const itemId = Number(idStr);
        rewardItemLookup[idStr] = {
          itemId,
          itemName: item.name,
          quality: item.quality,
          slot: item.slot,
          itemLevel: item.itemLevel,
          iconUrl: item.iconUrl,
        };
      }
    } catch {
      this.logger.warn(
        'Could not load quest-reward-items.json — falling back to boss loot table only',
      );
    }

    // Build item details map: prefer Wowhead data, fall back to boss loot table
    const itemDetailsMap = new Map<number, EnrichedQuestReward>();

    // First: populate from Wowhead JSON (quest-specific rewards)
    for (const itemId of allItemIds) {
      const wowheadItem = rewardItemLookup[String(itemId)];
      if (wowheadItem) {
        itemDetailsMap.set(itemId, wowheadItem);
      }
    }

    // Second: fill gaps from boss loot table (items that are also boss drops)
    const missingItemIds = [...allItemIds].filter(
      (id) => !itemDetailsMap.has(id),
    );
    if (missingItemIds.length > 0) {
      const lootRows = await this.db
        .select({
          itemId: wowClassicBossLoot.itemId,
          itemName: wowClassicBossLoot.itemName,
          quality: wowClassicBossLoot.quality,
          slot: wowClassicBossLoot.slot,
          itemLevel: wowClassicBossLoot.itemLevel,
          iconUrl: wowClassicBossLoot.iconUrl,
        })
        .from(wowClassicBossLoot)
        .where(inArray(wowClassicBossLoot.itemId, missingItemIds));

      for (const row of lootRows) {
        if (!itemDetailsMap.has(row.itemId)) {
          itemDetailsMap.set(row.itemId, {
            itemId: row.itemId,
            itemName: row.itemName,
            quality: row.quality,
            slot: row.slot,
            itemLevel: row.itemLevel,
            iconUrl: row.iconUrl,
          });
        }
      }
    }

    // Collect quests that have prerequisites for batch chain lookup
    const questsWithPrereqs = quests.filter((q) => q.prevQuestId !== null);
    const chainMap = new Map<number, DungeonQuestDto[]>();

    // Fetch chains in parallel
    await Promise.all(
      questsWithPrereqs.map(async (quest) => {
        const chain = await this.getQuestChain(quest.questId);
        chainMap.set(quest.questId, chain);
      }),
    );

    // Build enriched DTOs
    return quests.map((quest) => {
      const rewards = quest.rewardsJson
        ? quest.rewardsJson.map((itemId) => {
            const details = itemDetailsMap.get(itemId);
            return (
              details ?? {
                itemId,
                itemName: `Item #${itemId}`,
                quality: 'Common',
                slot: null,
                itemLevel: null,
                iconUrl: null,
              }
            );
          })
        : null;

      const prerequisiteChain = chainMap.get(quest.questId) ?? null;

      return {
        ...quest,
        rewards,
        prerequisiteChain,
      };
    });
  }
}
