import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray, and } from 'drizzle-orm';
import type { BossEncounterDto, BossLootDto } from '@raid-ledger/contract';
import type Redis from 'ioredis';

import * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { redisSwr } from '../../common/swr-cache';
import { BossEncounterSeeder } from './boss-encounter-seeder';

/** Cache key prefix for WoW Classic boss data */
const CACHE_PREFIX = 'wow:bosses';
/** 24 hours in seconds */
const CACHE_TTL_SEC = 86400;

/**
 * Variant-to-expansion-set mapping for boss encounters.
 * Each variant includes encounters from all expansions up to and including its era.
 */
const VARIANT_EXPANSIONS: Record<string, string[]> = {
  classic_era: ['classic'],
  classic_era_sod: ['classic', 'sod'],
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

/**
 * Service for querying boss encounter and loot data with variant-aware filtering.
 * Static data is cached in Redis with 24h TTL (ROK-665).
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
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * Get the expansion set for a given WoW game variant.
   */
  getExpansionsForVariant(variant: string): string[] {
    return VARIANT_EXPANSIONS[variant] ?? VARIANT_EXPANSIONS['classic_era'];
  }

  /**
   * Get all boss encounters for an instance, filtered by variant.
   * Results are cached in Redis for 24h.
   */
  async getBossesForInstance(
    instanceId: number,
    variant: string = 'classic_era',
  ): Promise<BossEncounterDto[]> {
    const cacheKey = `${CACHE_PREFIX}:instance:${instanceId}:${variant}`;
    const result = await redisSwr<BossEncounterDto[]>({
      redis: this.redis,
      key: cacheKey,
      ttlSec: CACHE_TTL_SEC,
      fetcher: () => this.fetchBossesForInstance(instanceId, variant),
    });
    return result ?? [];
  }

  private async fetchBossesForInstance(
    instanceId: number,
    variant: string,
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
   * Results are cached in Redis for 24h.
   */
  async getLootForBoss(
    bossId: number,
    variant: string = 'classic_era',
  ): Promise<BossLootDto[]> {
    const cacheKey = `${CACHE_PREFIX}:loot:${bossId}:${variant}`;
    const result = await redisSwr<BossLootDto[]>({
      redis: this.redis,
      key: cacheKey,
      ttlSec: CACHE_TTL_SEC,
      fetcher: () => this.fetchLootForBoss(bossId, variant),
    });
    return result ?? [];
  }

  private async fetchLootForBoss(
    bossId: number,
    variant: string,
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
    const result = await this.seeder.seed();
    await this.clearCache();
    return result;
  }

  /**
   * Drop all boss encounter data (delegates to seeder).
   */
  async dropBosses(): Promise<void> {
    await this.seeder.drop();
    await this.clearCache();
  }

  /**
   * Clear all cached boss/loot data from Redis.
   * Called after seed refresh, data drop, or admin refresh actions.
   */
  async clearCache(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${CACHE_PREFIX}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cleared ${keys.length} boss cache entries`);
      }
    } catch (err) {
      this.logger.warn(`Failed to clear boss cache: ${err}`);
    }
  }

  private toBossDto(
    row: typeof wowClassicBosses.$inferSelect,
  ): BossEncounterDto {
    return {
      id: row.id,
      instanceId: row.instanceId,
      name: row.name,
      order: row.order,
      expansion: row.expansion as BossEncounterDto['expansion'],
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
      quality: row.quality as BossLootDto['quality'],
      itemLevel: row.itemLevel,
      dropRate: row.dropRate,
      expansion: row.expansion as BossLootDto['expansion'],
      classRestrictions: row.classRestrictions,
      iconUrl: row.iconUrl,
      itemSubclass: row.itemSubclass,
    };
  }
}
