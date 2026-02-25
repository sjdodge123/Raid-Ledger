import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray, and } from 'drizzle-orm';

import * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { BossEncounterSeeder } from './boss-encounter-seeder';

/**
 * Variant-to-expansion-set mapping for boss encounters.
 * Each variant includes encounters from all expansions up to and including its era.
 */
const VARIANT_EXPANSIONS: Record<string, string[]> = {
  classic_era: ['classic'],
  classic_anniversary: ['classic', 'tbc'],
  classic: ['classic', 'tbc', 'wotlk', 'cata'],
  retail: ['classic', 'tbc', 'wotlk', 'cata'],
};

/**
 * Sub-instance wing-to-boss mapping for multi-wing dungeons.
 *
 * Synthetic sub-instance IDs are generated as `parentId * 100 + suffix`
 * (e.g., SM parent = 316, SM:Armory = 31603). Boss data is seeded under
 * the parent instance ID, so when a sub-instance is queried we need to
 * filter the parent's boss list to only the bosses belonging to that wing.
 *
 * Key format: `${parentId}:${suffix}` — value is the set of boss names.
 */
const SUB_INSTANCE_BOSSES: Record<string, Set<string>> = {
  // Scarlet Monastery (parent 316)
  '316:1': new Set(['Interrogator Vishas', 'Bloodmage Thalnos']), // SM: Graveyard
  '316:2': new Set(['Houndmaster Loksey', 'Arcanist Doan']), // SM: Library
  '316:3': new Set(['Herod']), // SM: Armory
  '316:4': new Set([
    'High Inquisitor Fairbanks',
    'Scarlet Commander Mograine',
    'High Inquisitor Whitemane',
  ]), // SM: Cathedral
  // Maraudon (journal parent 232)
  '232:1': new Set(['Noxxion', 'Razorlash', 'Lord Vyletongue']), // Purple
  '232:2': new Set(['Celebras the Cursed', 'Landslide']), // Orange
  '232:3': new Set(['Tinkerer Gizlock', 'Rotgrip', 'Princess Theradras']), // Inner
};

export interface BossEncounterDto {
  id: number;
  instanceId: number;
  name: string;
  order: number;
  expansion: string;
  sodModified: boolean;
}

export interface BossLootDto {
  id: number;
  bossId: number;
  itemId: number;
  itemName: string;
  slot: string | null;
  quality: string;
  itemLevel: number | null;
  dropRate: string | null;
  expansion: string;
  classRestrictions: string[] | null;
  iconUrl: string | null;
  itemSubclass: string | null;
}

/**
 * Service for querying boss encounter and loot data with variant-aware filtering.
 *
 * ROK-244: Variant-Aware Boss & Loot Table Seed Data
 */
@Injectable()
export class BossEncountersService {
  private readonly logger = new Logger(BossEncountersService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly seeder: BossEncounterSeeder,
  ) {}

  /**
   * Get the expansion set for a given WoW game variant.
   */
  getExpansionsForVariant(variant: string): string[] {
    return VARIANT_EXPANSIONS[variant] ?? VARIANT_EXPANSIONS['classic_era'];
  }

  /**
   * Get all boss encounters for an instance, filtered by variant.
   * SoD-modified bosses are only included for SoD-enabled variants.
   *
   * For sub-instances (synthetic IDs > 10000, e.g. 31603 = SM:Armory),
   * resolves to the parent instance and filters to only the wing's bosses.
   */
  async getBossesForInstance(
    instanceId: number,
    variant: string = 'classic_era',
  ): Promise<BossEncounterDto[]> {
    const expansions = this.getExpansionsForVariant(variant);

    // Resolve sub-instance to parent and determine wing boss filter
    let queryInstanceId = instanceId;
    let wingBossNames: Set<string> | undefined;

    if (instanceId > 10000) {
      const parentId = Math.floor(instanceId / 100);
      const suffix = instanceId % 100;
      queryInstanceId = parentId;
      wingBossNames = SUB_INSTANCE_BOSSES[`${parentId}:${suffix}`];
    }

    const rows = await this.db
      .select()
      .from(wowClassicBosses)
      .where(
        and(
          eq(wowClassicBosses.instanceId, queryInstanceId),
          inArray(wowClassicBosses.expansion, expansions),
        ),
      )
      .orderBy(wowClassicBosses.order);

    // Filter to wing-specific bosses when querying a sub-instance
    const filtered = wingBossNames
      ? rows.filter((row) => wingBossNames.has(row.name))
      : rows;

    // Reassign sequential order numbers for sub-instance filtered results
    if (wingBossNames) {
      return filtered.map((row, i) => ({
        ...this.toBossDto(row),
        order: i + 1,
      }));
    }

    return filtered.map((row) => this.toBossDto(row));
  }

  /**
   * Get loot items for a boss, filtered by variant's expansion set.
   */
  async getLootForBoss(
    bossId: number,
    variant: string = 'classic_era',
  ): Promise<BossLootDto[]> {
    const expansions = this.getExpansionsForVariant(variant);

    const rows = await this.db
      .select()
      .from(wowClassicBossLoot)
      .where(
        and(
          eq(wowClassicBossLoot.bossId, bossId),
          inArray(wowClassicBossLoot.expansion, expansions),
        ),
      )
      .orderBy(wowClassicBossLoot.quality);

    return rows.map((row) => this.toLootDto(row));
  }

  /**
   * Seed boss encounter data (delegates to seeder).
   */
  async seedBosses(): Promise<{
    bossesInserted: number;
    lootInserted: number;
  }> {
    return this.seeder.seed();
  }

  /**
   * Drop all boss encounter data (delegates to seeder).
   */
  async dropBosses(): Promise<void> {
    return this.seeder.drop();
  }

  private toBossDto(
    row: typeof wowClassicBosses.$inferSelect,
  ): BossEncounterDto {
    return {
      id: row.id,
      instanceId: row.instanceId,
      name: row.name,
      order: row.order,
      expansion: row.expansion,
      sodModified: row.sodModified,
    };
  }

  private toLootDto(row: typeof wowClassicBossLoot.$inferSelect): BossLootDto {
    return {
      id: row.id,
      bossId: row.bossId,
      itemId: row.itemId,
      itemName: row.itemName,
      slot: row.slot,
      quality: row.quality,
      itemLevel: row.itemLevel,
      dropRate: row.dropRate,
      expansion: row.expansion,
      classRestrictions: row.classRestrictions,
      iconUrl: row.iconUrl,
      itemSubclass: row.itemSubclass,
    };
  }
}
