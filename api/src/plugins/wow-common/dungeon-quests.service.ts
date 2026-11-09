import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { defined } from '../../common/defined.helpers';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { inArray, and } from 'drizzle-orm';
import type Redis from 'ioredis';

import * as schema from '../../drizzle/schema';
import { wowClassicDungeonQuests } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { redisSwr } from '../../common/swr-cache';
import { SettingsService } from '../../settings/settings.service';
import { DungeonQuestSeeder } from './dungeon-quest-seeder';
import {
  applyChainOverlay,
  applyInstanceOverlay,
} from './dungeon-quests.overlay';
import {
  MAX_CHAIN_DEPTH,
  VARIANT_EXPANSIONS,
  toDto,
  walkChainInMemory,
  prerequisiteChainOf,
  collectFrontierIds,
  loadRewardItemLookup,
  buildItemDetailsMap,
  collectAllItemIds,
} from './dungeon-quests.helpers';
import { resolveQuestInstanceIds } from './forever-instance-aliases';
import { WOW_FOREVER_CONFIG_UPDATED } from './forever.settings';
import { isForeverQuestImportEnabled } from './forever-quest-import/forever-quest-import-switch';
import type {
  DungeonQuestDto,
  EnrichedDungeonQuestDto,
} from './dungeon-quests.types';

// Re-export types for backward compatibility
export type {
  DungeonQuestDto,
  EnrichedDungeonQuestDto,
} from './dungeon-quests.types';

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
    private readonly settings: SettingsService,
  ) {}

  /** Get the expansion set for a given WoW game variant. */
  getExpansionsForVariant(variant: string): string[] {
    return (
      VARIANT_EXPANSIONS[variant] ??
      defined(VARIANT_EXPANSIONS['classic_era'], 'classic_era expansions')
    );
  }

  /**
   * Get all quests for a dungeon instance, filtered by variant, with the
   * Blizzard overlay merged in (ROK-2143; kill switch off → bundled only).
   */
  async getQuestsForInstance(
    instanceId: number,
    variant: string = 'classic_era',
  ): Promise<DungeonQuestDto[]> {
    const expansions = this.getExpansionsForVariant(variant);
    const instanceIds = resolveQuestInstanceIds(instanceId);

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

    return applyInstanceOverlay(
      { db: this.db, settings: this.settings },
      rows.map((row) => toDto(row)),
      { instanceIds, expansions },
    );
  }

  /**
   * Get the full prerequisite chain for a quest. Codex P2: the root is
   * loaded like any chain link — bundled row merged with the overlay, or an
   * overlay-only row (kill switch on) — so the walk follows the same
   * prevQuestId the returned root names, and a root only Blizzard has still
   * gets its chain.
   */
  async getQuestChain(questId: number): Promise<DungeonQuestDto[]> {
    const [dto] = await this.loadChainLinks([questId]);
    if (!dto) return [];
    const questLookup = new Map<number, DungeonQuestDto>();
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

  /** A Forever config save may flip the quest overlay — drop the cache (ROK-2143). */
  @OnEvent(WOW_FOREVER_CONFIG_UPDATED)
  async onForeverConfigUpdated(): Promise<void> {
    await this.clearCache();
  }

  /**
   * Enriched quests for an instance — resolved reward items and prerequisite
   * chains (ROK-246, ROK-665). The key carries the overlay kill switch, so
   * flipping `wow_forever_quest_import` by any path misses the cache (ROK-2143).
   */
  async getEnrichedQuestsForInstance(
    instanceId: number,
    variant: string = 'classic_era',
  ): Promise<EnrichedDungeonQuestDto[]> {
    const overlay = (await isForeverQuestImportEnabled(this.settings))
      ? 'bz'
      : 'bundled';
    const cacheKey = `${CACHE_PREFIX}:enriched:${overlay}:${instanceId}:${variant}`;
    const result = await redisSwr<EnrichedDungeonQuestDto[]>({
      redis: this.redis,
      key: cacheKey,
      ttlSec: CACHE_TTL_SEC,
      fetcher: () => this.fetchEnrichedQuests(instanceId, variant),
    });
    return result ?? [];
  }

  /** Fetch enriched quests with rewards and chains. */
  private async fetchEnrichedQuests(
    instanceId: number,
    variant: string,
  ): Promise<EnrichedDungeonQuestDto[]> {
    const quests = await this.getQuestsForInstance(instanceId, variant);
    const allItemIds = collectAllItemIds(quests);
    const rewardItemLookup = await loadRewardItemLookup();
    const itemDetailsMap = await buildItemDetailsMap(
      this.db,
      allItemIds,
      rewardItemLookup,
    );
    const chainMap = await this.batchGetQuestChains(quests);

    return quests.map((quest) => ({
      ...quest,
      rewards: this.resolveRewards(quest, itemDetailsMap),
      prerequisiteChain: chainMap.get(quest.questId) ?? null,
    }));
  }

  /** Resolve reward items for a single quest. */
  private resolveRewards(
    quest: DungeonQuestDto,
    itemDetailsMap: Map<
      number,
      {
        itemId: number;
        itemName: string;
        quality: string;
        slot: string | null;
        itemLevel: number | null;
        iconUrl: string | null;
        itemSubclass: string | null;
      }
    >,
  ) {
    if (!quest.rewardsJson) return null;
    return quest.rewardsJson.map(
      (itemId) =>
        itemDetailsMap.get(itemId) ?? {
          itemId,
          itemName: `Item #${itemId}`,
          quality: 'Common',
          slot: null,
          itemLevel: null,
          iconUrl: null,
          itemSubclass: null,
        },
    );
  }

  /**
   * Batch-fetch prerequisite chains for all quests (ROK-447). A quest whose
   * prerequisite is not in our data gets no chain (ROK-2143).
   */
  private async batchGetQuestChains(
    quests: DungeonQuestDto[],
  ): Promise<Map<number, DungeonQuestDto[]>> {
    const chainMap = new Map<number, DungeonQuestDto[]>();
    const questsWithPrereqs = quests.filter((q) => q.prevQuestId !== null);
    if (questsWithPrereqs.length === 0) return chainMap;

    const questLookup = new Map<number, DungeonQuestDto>();
    for (const q of quests) questLookup.set(q.questId, q);

    await this.expandFrontier(quests, questLookup);

    for (const quest of questsWithPrereqs) {
      const chain = prerequisiteChainOf(quest, questLookup);
      if (chain) chainMap.set(quest.questId, chain);
    }
    return chainMap;
  }

  /** Iteratively discover and fetch all chain-linked quests not yet in memory. */
  private async expandFrontier(
    quests: DungeonQuestDto[],
    questLookup: Map<number, DungeonQuestDto>,
  ): Promise<void> {
    let frontier = collectFrontierIds(quests, questLookup);
    let iterations = 0;

    while (frontier.size > 0 && iterations < MAX_CHAIN_DEPTH) {
      iterations++;
      const idsToFetch = [...frontier];
      const dtos = await this.loadChainLinks(idsToFetch);
      const newFrontier = new Set<number>();
      for (const dto of dtos) {
        questLookup.set(dto.questId, dto);
        if (dto.prevQuestId !== null && !questLookup.has(dto.prevQuestId))
          newFrontier.add(dto.prevQuestId);
        if (dto.nextQuestId !== null && !questLookup.has(dto.nextQuestId))
          newFrontier.add(dto.nextQuestId);
      }
      for (const id of idsToFetch) {
        if (!questLookup.has(id))
          questLookup.set(id, undefined as unknown as DungeonQuestDto);
      }
      frontier = newFrontier;
    }
  }

  /** Walk one direction of a quest chain, fetching missing links from DB. */
  private async walkChainDirection(
    startId: number | null,
    direction: 'prev' | 'next',
    questLookup: Map<number, DungeonQuestDto>,
  ): Promise<void> {
    let cur = startId;
    while (
      cur !== null &&
      !questLookup.has(cur) &&
      questLookup.size < MAX_CHAIN_DEPTH
    ) {
      const [dto] = await this.loadChainLinks([cur]);
      if (!dto) break;
      questLookup.set(dto.questId, dto);
      cur = direction === 'prev' ? dto.prevQuestId : dto.nextQuestId;
    }
  }

  /**
   * Chain links by id. M3: they carry the same Blizzard-overlay prevQuestId
   * as the instance's own quests, so the chain agrees with the cards. Codex
   * P2: an id only the overlay has comes from the overlay (kill switch on).
   */
  private async loadChainLinks(ids: number[]): Promise<DungeonQuestDto[]> {
    const rows = await this.db
      .select()
      .from(wowClassicDungeonQuests)
      .where(inArray(wowClassicDungeonQuests.questId, ids));
    return applyChainOverlay(
      { db: this.db, settings: this.settings },
      rows.map((row) => toDto(row)),
      ids,
    );
  }

  /** Fetch chain quest links for a single quest's chain walk. */
  private async fetchChainQuests(
    dto: DungeonQuestDto,
    questLookup: Map<number, DungeonQuestDto>,
  ): Promise<void> {
    await this.walkChainDirection(dto.prevQuestId, 'prev', questLookup);
    await this.walkChainDirection(dto.nextQuestId, 'next', questLookup);
  }
}
