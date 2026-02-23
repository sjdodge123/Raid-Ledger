import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { readFile } from 'fs/promises';
import { join } from 'path';

import * as schema from '../../drizzle/schema';
import { wowClassicDungeonQuests } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

/**
 * Seeds the wow_classic_dungeon_quests table from the bundled JSON snapshot.
 * Called on plugin install; data dropped on plugin uninstall.
 *
 * ROK-245: Variant-Aware Dungeon Quest Database
 */
@Injectable()
export class DungeonQuestSeeder {
  private readonly logger = new Logger(DungeonQuestSeeder.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Seed all dungeon quests from the bundled data file.
   * Uses upsert (ON CONFLICT DO NOTHING) to be idempotent.
   */
  async seed(): Promise<{ inserted: number; total: number }> {
    const dataPath = join(__dirname, 'data', 'dungeon-quest-data.json');
    const raw = await readFile(dataPath, 'utf-8');
    const quests = JSON.parse(raw) as Array<{
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
    }>;

    this.logger.log(`Seeding ${quests.length} dungeon quests...`);

    // Batch insert in chunks of 100 to avoid param limits
    const BATCH_SIZE = 100;
    let inserted = 0;

    for (let i = 0; i < quests.length; i += BATCH_SIZE) {
      const batch = quests.slice(i, i + BATCH_SIZE);
      const result = await this.db
        .insert(wowClassicDungeonQuests)
        .values(
          batch.map((q) => ({
            questId: q.questId,
            dungeonInstanceId: q.dungeonInstanceId,
            name: q.name,
            questLevel: q.questLevel,
            requiredLevel: q.requiredLevel,
            expansion: q.expansion,
            questGiverNpc: q.questGiverNpc,
            questGiverZone: q.questGiverZone,
            prevQuestId: q.prevQuestId,
            nextQuestId: q.nextQuestId,
            rewardsJson: q.rewardsJson,
            objectives: q.objectives,
            classRestriction: q.classRestriction,
            raceRestriction: q.raceRestriction,
            startsInsideDungeon: q.startsInsideDungeon,
            sharable: q.sharable,
            rewardXp: q.rewardXp,
            rewardGold: q.rewardGold,
            rewardType: q.rewardType,
          })),
        )
        .onConflictDoNothing({ target: wowClassicDungeonQuests.questId })
        .returning({ id: wowClassicDungeonQuests.id });

      inserted += result.length;
    }

    this.logger.log(`Seeded ${inserted}/${quests.length} dungeon quests`);
    return { inserted, total: quests.length };
  }

  /**
   * Remove all dungeon quest data (called on plugin uninstall).
   */
  async drop(): Promise<void> {
    await this.db.delete(wowClassicDungeonQuests);
    this.logger.log('Dropped all dungeon quest data');
  }
}
