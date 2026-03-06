import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { BlizzardService } from './blizzard.service';
import { BossEncountersService } from './boss-encounters.service';
import { DungeonQuestsService } from './dungeon-quests.service';
import {
  BASE_URL,
  NAMESPACE,
  EXPANSION_KEY,
  type JournalInstance,
  type JournalEncounter,
  upsertBoss,
  processLootItem,
} from './boss-data-refresh.helpers';

/**
 * Refreshes boss encounter and loot data from the Blizzard Journal API.
 * ROK-474: Live refresh of boss & loot data
 */
@Injectable()
export class BossDataRefreshService {
  private readonly logger = new Logger(BossDataRefreshService.name);
  private isRefreshing = false;

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private readonly blizzardService: BlizzardService,
    private readonly bossEncountersService: BossEncountersService,
    private readonly dungeonQuestsService: DungeonQuestsService,
  ) {}

  /** Refresh boss data for all known Classic/TBC instances. */
  async refresh(): Promise<{ bosses: number; loot: number }> {
    if (this.isRefreshing) {
      this.logger.warn('Boss data refresh already in progress, skipping');
      return { bosses: 0, loot: 0 };
    }
    this.isRefreshing = true;
    this.logger.log('Starting boss data refresh from Blizzard Journal API...');

    try {
      const instances = await this.fetchAllInstanceIds();
      this.logger.log(`Found ${instances.length} instances to refresh`);
      let totalBosses = 0,
        totalLoot = 0;

      for (const inst of instances) {
        try {
          const result = await this.refreshInstance(inst.id, inst.expansion);
          totalBosses += result.bosses;
          totalLoot += result.loot;
        } catch (err) {
          this.logger.warn(`Failed to refresh instance ${inst.id}: ${err}`);
        }
        await this.sleep(100);
      }

      await this.bossEncountersService.clearCache();
      await this.dungeonQuestsService.clearCache();
      this.logger.log(
        `Boss data refresh complete: ${totalBosses} bosses, ${totalLoot} loot items`,
      );
      return { bosses: totalBosses, loot: totalLoot };
    } finally {
      this.isRefreshing = false;
    }
  }

  /** Fetch TBC instance IDs from the Blizzard journal. */
  private async fetchAllInstanceIds(): Promise<
    Array<{ id: number; expansion: string }>
  > {
    const result: Array<{ id: number; expansion: string }> = [];
    const targetExpansions = new Set(['Burning Crusade']);

    const index = await this.blizzardService.fetchBlizzardApi<{
      tiers: Array<{ id: number; name: string }>;
    }>(
      `${BASE_URL}/data/wow/journal-expansion/index?namespace=${NAMESPACE}&locale=en_US`,
    );
    if (!index) return result;

    for (const tier of index.tiers) {
      const detail = await this.blizzardService.fetchBlizzardApi<{
        name: string;
        dungeons?: Array<{ id: number; name: string }>;
        raids?: Array<{ id: number; name: string }>;
      }>(
        `${BASE_URL}/data/wow/journal-expansion/${tier.id}?namespace=${NAMESPACE}&locale=en_US`,
      );
      if (!detail || !targetExpansions.has(detail.name)) continue;
      const expansion = EXPANSION_KEY[detail.name] || 'classic';
      for (const d of detail.dungeons || [])
        result.push({ id: d.id, expansion });
      for (const r of detail.raids || []) result.push({ id: r.id, expansion });
      await this.sleep(100);
    }
    return result;
  }

  /** Refresh a single instance's boss encounters and loot. */
  private async refreshInstance(
    instanceId: number,
    expansion: string,
  ): Promise<{ bosses: number; loot: number }> {
    const journal =
      await this.blizzardService.fetchBlizzardApi<JournalInstance>(
        `${BASE_URL}/data/wow/journal-instance/${instanceId}?namespace=${NAMESPACE}&locale=en_US`,
      );
    if (!journal?.encounters?.length) return { bosses: 0, loot: 0 };

    let bossCount = 0,
      lootCount = 0;
    for (let i = 0; i < journal.encounters.length; i++) {
      const enc = journal.encounters[i];
      const bossId = await upsertBoss(
        this.db,
        instanceId,
        enc.name,
        i + 1,
        expansion,
      );
      bossCount++;
      if (!bossId) continue;

      lootCount += await this.processEncounterLoot(enc.id, bossId, expansion);
    }
    return { bosses: bossCount, loot: lootCount };
  }

  /** Fetch and process loot for a single encounter. */
  private async processEncounterLoot(
    encounterId: number,
    bossId: number,
    expansion: string,
  ): Promise<number> {
    const encDetail =
      await this.blizzardService.fetchBlizzardApi<JournalEncounter>(
        `${BASE_URL}/data/wow/journal-encounter/${encounterId}?namespace=${NAMESPACE}&locale=en_US`,
      );
    await this.sleep(100);
    if (!encDetail?.items?.length) return 0;

    let lootCount = 0;
    for (const itemEntry of encDetail.items) {
      if (!itemEntry.item?.id) continue;
      try {
        const upserted = await processLootItem(
          this.db,
          this.blizzardService,
          bossId,
          itemEntry.item,
          expansion,
        );
        if (upserted) lootCount++;
        await this.sleep(50);
      } catch {
        /* Skip individual item failures */
      }
    }
    return lootCount;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
