/**
 * ITAD (IsThereAnyDeal) service (ROK-772).
 * Provides lookup, search, and info capabilities via the ITAD API.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { itadFetch, itadPost } from './itad-http.util';
import type {
  ItadGame,
  ItadLookupResponse,
  ItadGameInfo,
  ItadShopLookupResponse,
} from './itad.constants';
import { ITAD_STEAM_SHOP_ID } from './itad.constants';
import {
  getCachedLookup,
  setCachedLookup,
  getCachedSearch,
  setCachedSearch,
  getCachedInfo,
  setCachedInfo,
} from './itad-cache.util';

const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Parse the shop lookup response into a map of ITAD UUID -> Steam App ID.
 * Response format: { "app/{appId}": "itad-uuid", ... }
 */
function parseShopLookupResponse(
  response: ItadShopLookupResponse,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [shopKey, itadId] of Object.entries(response)) {
    if (!itadId || !shopKey.startsWith('app/')) continue;
    const appId = parseInt(shopKey.replace('app/', ''), 10);
    if (!isNaN(appId)) result.set(itadId, appId);
  }
  return result;
}

@Injectable()
export class ItadService {
  private readonly logger = new Logger(ItadService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly settingsService: SettingsService,
  ) {}

  /** Look up an ITAD game by Steam App ID. Returns null if not found or unconfigured. */
  async lookupBySteamAppId(appId: number): Promise<ItadGame | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    const cached = await getCachedLookup<ItadGame>(this.redis, appId);
    if (cached) return cached;

    const result = await itadFetch<ItadLookupResponse>('/games/lookup/v1', {
      key: apiKey,
      appid: String(appId),
    });

    if (!result?.found || !result.game) return null;

    await setCachedLookup(this.redis, appId, result.game);
    return result.game;
  }

  /** Search ITAD games by title. Returns empty array if unconfigured. */
  async searchGames(
    title: string,
    limit = DEFAULT_SEARCH_LIMIT,
  ): Promise<ItadGame[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return [];

    const cached = await getCachedSearch<ItadGame[]>(this.redis, title, limit);
    if (cached) return cached;

    const result = await itadFetch<ItadGame[]>('/games/search/v1', {
      key: apiKey,
      title,
      results: String(limit),
    });

    const games = result ?? [];
    if (games.length > 0) {
      await setCachedSearch(this.redis, title, limit, games);
    }
    return games;
  }

  /** Get full ITAD game info by ITAD UUID. Returns null if not found or unconfigured. */
  async getGameInfo(itadId: string): Promise<ItadGameInfo | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    const cached = await getCachedInfo<ItadGameInfo>(this.redis, itadId);
    if (cached) return cached;

    const result = await itadFetch<ItadGameInfo>('/games/info/v2', {
      key: apiKey,
      id: itadId,
    });

    if (!result) return null;

    await setCachedInfo(this.redis, itadId, result);
    return result;
  }

  /**
   * Batch-resolve ITAD game UUIDs to Steam App IDs via shop lookup.
   * @param games - Array of { id, slug } from ITAD search results
   * @returns Map of ITAD UUID to Steam App ID (number)
   */
  async lookupSteamAppIds(
    games: { id: string; slug: string }[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (games.length === 0) return result;

    const apiKey = await this.getApiKey();
    if (!apiKey) return result;

    const itadIds = games.map((g) => g.id);
    const shopId = String(ITAD_STEAM_SHOP_ID);
    const response = await itadPost<ItadShopLookupResponse>(
      `/lookup/shop/${shopId}/id/v1`,
      { key: apiKey, shops: shopId },
      itadIds,
    );

    if (!response) return result;

    return parseShopLookupResponse(response);
  }

  /** Read API key from settings. Logs a warning once if missing. */
  private async getApiKey(): Promise<string | null> {
    const key = await this.settingsService.getItadApiKey();
    if (!key) {
      this.logger.debug('ITAD API key not configured');
    }
    return key;
  }
}
