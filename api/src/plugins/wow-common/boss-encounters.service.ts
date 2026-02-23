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
   */
  async getBossesForInstance(
    instanceId: number,
    variant: string = 'classic_era',
  ): Promise<BossEncounterDto[]> {
    const expansions = this.getExpansionsForVariant(variant);

    const rows = await this.db
      .select()
      .from(wowClassicBosses)
      .where(
        and(
          eq(wowClassicBosses.instanceId, instanceId),
          inArray(wowClassicBosses.expansion, expansions),
        ),
      )
      .orderBy(wowClassicBosses.order);

    return rows.map((row) => this.toBossDto(row));
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
    };
  }
}
