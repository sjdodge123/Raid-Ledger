import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray, and } from 'drizzle-orm';
import type Redis from 'ioredis';

import * as schema from '../../drizzle/schema';
import { wowClassicDungeonQuests } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { redisSwr } from '../../common/swr-cache';
import { DungeonQuestSeeder } from './dungeon-quest-seeder';
import {
  MAX_CHAIN_DEPTH, VARIANT_EXPANSIONS, toDto, walkChainInMemory,
  collectFrontierIds, loadRewardItemLookup, buildItemDetailsMap, collectAllItemIds,
} from './dungeon-quests.helpers';
import type { DungeonQuestDto, EnrichedDungeonQuestDto } from './dungeon-quests.types';

// Re-export types for backward compatibility
export type { DungeonQuestDto, EnrichedDungeonQuestDto } from './dungeon-quests.types';

/** Cache key prefix for WoW Classic quest data */
const CACHE_PREFIX = 'wow:quests';
/** 24 hours in seconds */
const CACHE_TTL_SEC = 86400;

/**
 * Service for querying dungeon quest data with variant-aware filtering.
 * ROK-245: Variant-Aware Dungeon Quest Database
 */
@Injectable()
export class DungeonQuestsService {
  private readonly logger = new Logger(DungeonQuestsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private readonly seeder: DungeonQuestSeeder,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Get the expansion set for a given WoW game variant. */
  getExpansionsForVariant(variant: string): string[] {
    return VARIANT_EXPANSIONS[variant] ?? VARIANT_EXPANSIONS['classic_era'];
  }

  /** Get all quests for a dungeon instance, filtered by variant. */
  async getQuestsForInstance(instanceId: number, variant: string = 'classic_era'): Promise<DungeonQuestDto[]> {
    const expansions = this.getExpansionsForVariant(variant);
    const instanceIds = [instanceId];
    if (instanceId > 10000) instanceIds.push(Math.floor(instanceId / 100));

    const rows = await this.db.select().from(wowClassicDungeonQuests)
      .where(and(inArray(wowClassicDungeonQuests.dungeonInstanceId, instanceIds), inArray(wowClassicDungeonQuests.expansion, expansions)))
      .orderBy(wowClassicDungeonQuests.questLevel);

    return rows.map((row) => toDto(row));
  }

  /** Get the full prerequisite chain for a quest. */
  async getQuestChain(questId: number): Promise<DungeonQuestDto[]> {
    const [quest] = await this.db.select().from(wowClassicDungeonQuests)
      .where(eq(wowClassicDungeonQuests.questId, questId)).limit(1);
    if (!quest) return [];

    const questLookup = new Map<number, DungeonQuestDto>();
    const dto = toDto(quest);
    questLookup.set(dto.questId, dto);

    await this.fetchChainQuests(dto, questLookup);
    return walkChainInMemory(dto, questLookup);
  }

  /** Seed quest data (delegates to seeder). */
  async seedQuests(): Promise<{ inserted: number; total: number }> {
    const result = await this.seeder.seed();
    await this.clearCache();
    return result;
  }

  /** Drop all quest data (delegates to seeder). */
  async dropQuests(): Promise<void> {
    await this.seeder.drop();
    await this.clearCache();
  }

  /** Clear all cached quest data from Redis. */
  async clearCache(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${CACHE_PREFIX}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cleared ${keys.length} quest cache entries`);
      }
    } catch (err) {
      this.logger.warn(`Failed to clear quest cache: ${err}`);
    }
  }

  /** Get enriched quests for an instance — includes resolved reward items and prerequisite chains (ROK-246, ROK-665). */
  async getEnrichedQuestsForInstance(instanceId: number, variant: string = 'classic_era'): Promise<EnrichedDungeonQuestDto[]> {
    const cacheKey = `${CACHE_PREFIX}:enriched:${instanceId}:${variant}`;
    const result = await redisSwr<EnrichedDungeonQuestDto[]>({
      redis: this.redis, key: cacheKey, ttlSec: CACHE_TTL_SEC,
      fetcher: () => this.fetchEnrichedQuests(instanceId, variant),
    });
    return result ?? [];
  }

  /** Fetch enriched quests with rewards and chains. */
  private async fetchEnrichedQuests(instanceId: number, variant: string): Promise<EnrichedDungeonQuestDto[]> {
    const quests = await this.getQuestsForInstance(instanceId, variant);
    const allItemIds = collectAllItemIds(quests);
    const rewardItemLookup = await loadRewardItemLookup();
    const itemDetailsMap = await buildItemDetailsMap(this.db, allItemIds, rewardItemLookup);
    const chainMap = await this.batchGetQuestChains(quests);

    return quests.map((quest) => ({
      ...quest,
      rewards: this.resolveRewards(quest, itemDetailsMap),
      prerequisiteChain: chainMap.get(quest.questId) ?? null,
    }));
  }

  /** Resolve reward items for a single quest. */
  private resolveRewards(quest: DungeonQuestDto, itemDetailsMap: Map<number, { itemId: number; itemName: string; quality: string; slot: string | null; itemLevel: number | null; iconUrl: string | null; itemSubclass: string | null }>) {
    if (!quest.rewardsJson) return null;
    return quest.rewardsJson.map((itemId) =>
      itemDetailsMap.get(itemId) ?? { itemId, itemName: `Item #${itemId}`, quality: 'Common', slot: null, itemLevel: null, iconUrl: null, itemSubclass: null },
    );
  }

  /** Batch-fetch prerequisite chains for all quests (ROK-447). */
  private async batchGetQuestChains(quests: DungeonQuestDto[]): Promise<Map<number, DungeonQuestDto[]>> {
    const chainMap = new Map<number, DungeonQuestDto[]>();
    const questsWithPrereqs = quests.filter((q) => q.prevQuestId !== null);
    if (questsWithPrereqs.length === 0) return chainMap;

    const questLookup = new Map<number, DungeonQuestDto>();
    for (const q of quests) questLookup.set(q.questId, q);

    await this.expandFrontier(quests, questLookup);

    for (const quest of questsWithPrereqs) {
      chainMap.set(quest.questId, walkChainInMemory(quest, questLookup));
    }
    return chainMap;
  }

  /** Iteratively discover and fetch all chain-linked quests not yet in memory. */
  private async expandFrontier(quests: DungeonQuestDto[], questLookup: Map<number, DungeonQuestDto>): Promise<void> {
    let frontier = collectFrontierIds(quests, questLookup);
    let iterations = 0;

    while (frontier.size > 0 && iterations < MAX_CHAIN_DEPTH) {
      iterations++;
      const idsToFetch = [...frontier];
      const rows = await this.db.select().from(wowClassicDungeonQuests)
        .where(inArray(wowClassicDungeonQuests.questId, idsToFetch));

      const newFrontier = new Set<number>();
      for (const row of rows) {
        const dto = toDto(row);
        questLookup.set(dto.questId, dto);
        if (dto.prevQuestId !== null && !questLookup.has(dto.prevQuestId)) newFrontier.add(dto.prevQuestId);
        if (dto.nextQuestId !== null && !questLookup.has(dto.nextQuestId)) newFrontier.add(dto.nextQuestId);
      }
      for (const id of idsToFetch) {
        if (!questLookup.has(id)) questLookup.set(id, undefined as unknown as DungeonQuestDto);
      }
      frontier = newFrontier;
    }
  }

  /** Fetch chain quest links for a single quest's chain walk. */
  private async fetchChainQuests(dto: DungeonQuestDto, questLookup: Map<number, DungeonQuestDto>): Promise<void> {
    let currentPrev = dto.prevQuestId;
    while (currentPrev !== null && !questLookup.has(currentPrev) && questLookup.size < MAX_CHAIN_DEPTH) {
      const [prev] = await this.db.select().from(wowClassicDungeonQuests)
        .where(eq(wowClassicDungeonQuests.questId, currentPrev)).limit(1);
      if (!prev) break;
      const prevDto = toDto(prev);
      questLookup.set(prevDto.questId, prevDto);
      currentPrev = prevDto.prevQuestId;
    }
    let currentNext = dto.nextQuestId;
    while (currentNext !== null && !questLookup.has(currentNext) && questLookup.size < MAX_CHAIN_DEPTH) {
      const [next] = await this.db.select().from(wowClassicDungeonQuests)
        .where(eq(wowClassicDungeonQuests.questId, currentNext)).limit(1);
      if (!next) break;
      const nextDto = toDto(next);
      questLookup.set(nextDto.questId, nextDto);
      currentNext = nextDto.nextQuestId;
    }
  }
}
