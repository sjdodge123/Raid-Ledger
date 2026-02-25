import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

import * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { BlizzardService } from './blizzard.service';

const REGION = 'us';
const NAMESPACE = `static-${REGION}`;
const BASE_URL = `https://${REGION}.api.blizzard.com`;

/** Blizzard quality type → display name */
const QUALITY_MAP: Record<string, string> = {
  POOR: 'Poor',
  COMMON: 'Common',
  UNCOMMON: 'Uncommon',
  RARE: 'Rare',
  EPIC: 'Epic',
  LEGENDARY: 'Legendary',
};

/** Blizzard inventory_type → slot display name */
const SLOT_MAP: Record<string, string | null> = {
  HEAD: 'Head',
  NECK: 'Neck',
  SHOULDER: 'Shoulder',
  CHEST: 'Chest',
  WAIST: 'Waist',
  LEGS: 'Legs',
  FEET: 'Feet',
  WRIST: 'Wrist',
  HAND: 'Hands',
  FINGER: 'Finger',
  TRINKET: 'Trinket',
  CLOAK: 'Back',
  WEAPON: 'One-Hand',
  SHIELD: 'Shield',
  RANGED: 'Ranged',
  RANGEDRIGHT: 'Ranged',
  TWOHWEAPON: 'Two-Hand',
  WEAPONMAINHAND: 'Main Hand',
  WEAPONOFFHAND: 'Off Hand',
  HOLDABLE: 'Held In Off-hand',
  THROWN: 'Ranged',
  RELIC: 'Relic',
};

/** Expansion name from Blizzard → seed key */
const EXPANSION_KEY: Record<string, string> = {
  Classic: 'classic',
  'Burning Crusade': 'tbc',
  'Wrath of the Lich King': 'wotlk',
  Cataclysm: 'cata',
};

interface JournalInstance {
  id: number;
  name: string;
  expansion?: { name: string };
  encounters?: Array<{ id: number; name: string }>;
}

interface JournalEncounter {
  items?: Array<{ item: { id: number; name?: string } }>;
}

interface ItemDetail {
  name?: string;
  level?: number;
  quality?: { type: string };
  inventory_type?: { type: string };
  item_subclass?: { name: string };
}

interface ItemMedia {
  assets?: Array<{ value: string }>;
}

/**
 * Refreshes boss encounter and loot data from the Blizzard Journal API.
 * Called on a weekly cron schedule to keep seed data up to date.
 *
 * ROK-474: Live refresh of boss & loot data
 */
@Injectable()
export class BossDataRefreshService {
  private readonly logger = new Logger(BossDataRefreshService.name);
  private isRefreshing = false;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly blizzardService: BlizzardService,
  ) {}

  /**
   * Refresh boss data for all known Classic/TBC instances.
   * Fetches from Blizzard Journal API and upserts into the database.
   */
  async refresh(): Promise<{ bosses: number; loot: number }> {
    if (this.isRefreshing) {
      this.logger.warn('Boss data refresh already in progress, skipping');
      return { bosses: 0, loot: 0 };
    }

    this.isRefreshing = true;
    this.logger.log('Starting boss data refresh from Blizzard Journal API...');

    try {
      // Fetch all Classic + TBC instances from the journal
      const instances = await this.fetchAllInstanceIds();
      this.logger.log(
        `Found ${instances.length} instances to refresh`,
      );

      let totalBosses = 0;
      let totalLoot = 0;

      for (const inst of instances) {
        try {
          const result = await this.refreshInstance(inst.id, inst.expansion);
          totalBosses += result.bosses;
          totalLoot += result.loot;
        } catch (err) {
          this.logger.warn(
            `Failed to refresh instance ${inst.id}: ${err}`,
          );
        }
        // Rate limit: 100ms between instances
        await this.sleep(100);
      }

      this.logger.log(
        `Boss data refresh complete: ${totalBosses} bosses, ${totalLoot} loot items`,
      );
      return { bosses: totalBosses, loot: totalLoot };
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Fetch the list of Classic + TBC instance IDs from the Blizzard journal.
   */
  private async fetchAllInstanceIds(): Promise<
    Array<{ id: number; expansion: string }>
  > {
    const result: Array<{ id: number; expansion: string }> = [];
    const targetExpansions = new Set(['Classic', 'Burning Crusade']);

    // Fetch expansion index
    const index = await this.blizzardService.fetchBlizzardApi<{
      tiers: Array<{ id: number; name: string }>;
    }>(
      `${BASE_URL}/data/wow/journal-expansion/index?namespace=${NAMESPACE}&locale=en_US`,
    );
    if (!index) return result;

    // Fetch each expansion's instances
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
      for (const d of detail.dungeons || []) {
        result.push({ id: d.id, expansion });
      }
      for (const r of detail.raids || []) {
        result.push({ id: r.id, expansion });
      }
      await this.sleep(100);
    }

    return result;
  }

  /**
   * Refresh a single instance's boss encounters and loot.
   */
  private async refreshInstance(
    instanceId: number,
    expansion: string,
  ): Promise<{ bosses: number; loot: number }> {
    const journal =
      await this.blizzardService.fetchBlizzardApi<JournalInstance>(
        `${BASE_URL}/data/wow/journal-instance/${instanceId}?namespace=${NAMESPACE}&locale=en_US`,
      );
    if (!journal || !journal.encounters?.length) {
      return { bosses: 0, loot: 0 };
    }

    let bossCount = 0;
    let lootCount = 0;

    for (let i = 0; i < journal.encounters.length; i++) {
      const enc = journal.encounters[i];

      // Upsert boss
      const bossRows = await this.db
        .insert(wowClassicBosses)
        .values({
          instanceId,
          name: enc.name,
          order: i + 1,
          expansion,
          sodModified: false,
        })
        .onConflictDoUpdate({
          target: [
            wowClassicBosses.instanceId,
            wowClassicBosses.name,
            wowClassicBosses.expansion,
          ],
          set: {
            order: sql`excluded.order`,
            sodModified: sql`excluded.sod_modified`,
          },
        })
        .returning({ id: wowClassicBosses.id });

      bossCount++;
      const bossId = bossRows[0]?.id;
      if (!bossId) continue;

      // Fetch encounter loot
      const encDetail =
        await this.blizzardService.fetchBlizzardApi<JournalEncounter>(
          `${BASE_URL}/data/wow/journal-encounter/${enc.id}?namespace=${NAMESPACE}&locale=en_US`,
        );
      await this.sleep(100);
      if (!encDetail?.items?.length) continue;

      for (const itemEntry of encDetail.items) {
        const item = itemEntry.item;
        if (!item?.id) continue;

        try {
          const itemDetail =
            await this.blizzardService.fetchBlizzardApi<ItemDetail>(
              `${BASE_URL}/data/wow/item/${item.id}?namespace=${NAMESPACE}&locale=en_US`,
            );
          await this.sleep(50);
          if (!itemDetail) continue;

          const quality =
            QUALITY_MAP[itemDetail.quality?.type || ''] || 'Common';
          if (quality === 'Poor' || quality === 'Common') continue;

          const slotType = itemDetail.inventory_type?.type || '';
          const slot = SLOT_MAP[slotType] || null;

          const media =
            await this.blizzardService.fetchBlizzardApi<ItemMedia>(
              `${BASE_URL}/data/wow/media/item/${item.id}?namespace=${NAMESPACE}&locale=en_US`,
            );
          await this.sleep(50);

          await this.db
            .insert(wowClassicBossLoot)
            .values({
              bossId,
              itemId: item.id,
              itemName: item.name || itemDetail.name || `Item ${item.id}`,
              slot,
              quality,
              itemLevel: itemDetail.level || null,
              dropRate: null,
              expansion,
              classRestrictions: null,
              iconUrl: media?.assets?.[0]?.value || null,
              itemSubclass: itemDetail.item_subclass?.name || null,
            })
            .onConflictDoUpdate({
              target: [
                wowClassicBossLoot.bossId,
                wowClassicBossLoot.itemId,
                wowClassicBossLoot.expansion,
              ],
              set: {
                itemName: sql`excluded.item_name`,
                slot: sql`excluded.slot`,
                quality: sql`excluded.quality`,
                itemLevel: sql`excluded.item_level`,
                iconUrl: sql`excluded.icon_url`,
                itemSubclass: sql`excluded.item_subclass`,
              },
            });

          lootCount++;
        } catch {
          // Skip individual item failures
        }
      }
    }

    return { bosses: bossCount, loot: lootCount };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
