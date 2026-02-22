import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray, and } from 'drizzle-orm';

import * as schema from '../../drizzle/schema';
import { wowClassicDungeonQuests } from '../../drizzle/schema';
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
  ) { }

  /**
   * Get the expansion set for a given WoW game variant.
   */
  getExpansionsForVariant(variant: string): string[] {
    return VARIANT_EXPANSIONS[variant] ?? VARIANT_EXPANSIONS['classic_era'];
  }

  /**
   * Get all quests for a dungeon instance, filtered by variant.
   */
  async getQuestsForInstance(
    instanceId: number,
    variant: string = 'classic_era',
  ): Promise<DungeonQuestDto[]> {
    const expansions = this.getExpansionsForVariant(variant);

    const rows = await this.db
      .select()
      .from(wowClassicDungeonQuests)
      .where(
        and(
          eq(wowClassicDungeonQuests.dungeonInstanceId, instanceId),
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
    while (currentPrev !== null && !visited.has(currentPrev) && visited.size < DungeonQuestsService.MAX_CHAIN_DEPTH) {
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
    while (currentNext !== null && !visited.has(currentNext) && visited.size < DungeonQuestsService.MAX_CHAIN_DEPTH) {
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
  private toDto(row: typeof wowClassicDungeonQuests.$inferSelect): DungeonQuestDto {
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
}
