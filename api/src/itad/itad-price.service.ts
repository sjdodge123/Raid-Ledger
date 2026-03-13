/**
 * ITAD price service — fetches and caches game pricing data (ROK-419).
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { itadPost } from './itad-http.util';
import type {
  ItadOverviewResponse,
  ItadOverviewGameEntry,
} from './itad-price.types';
import { getCachedPrice, setCachedPrice } from './itad-cache.util';

@Injectable()
export class ItadPriceService {
  private readonly logger = new Logger(ItadPriceService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Fetch the pricing overview for an ITAD game.
   * Returns null if API key is not configured or if the request fails.
   * Results are cached in Redis with a 3-hour TTL.
   */
  async getOverview(itadGameId: string): Promise<ItadOverviewGameEntry | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    const cached = await getCachedPrice<ItadOverviewGameEntry>(
      this.redis,
      itadGameId,
    );
    if (cached) return cached;

    const response = await itadPost<ItadOverviewResponse>(
      '/games/overview/v2',
      { key: apiKey },
      [itadGameId],
    );

    if (!response?.prices?.length) return null;

    const entry = response.prices.find((p) => p.id === itadGameId) ?? null;
    if (entry) {
      await setCachedPrice(this.redis, itadGameId, entry);
    }
    return entry;
  }

  /**
   * Fetch pricing overviews for multiple ITAD games in one request.
   * Checks per-ID cache first, batch-fetches misses, caches results.
   * Returns entries only for IDs that have data.
   */
  async getOverviewBatch(
    itadGameIds: string[],
  ): Promise<ItadOverviewGameEntry[]> {
    if (itadGameIds.length === 0) return [];
    const apiKey = await this.getApiKey();
    if (!apiKey) return [];

    const { cached, missingIds } = await this.checkBatchCache(itadGameIds);
    if (missingIds.length === 0) return cached;

    const fetched = await this.fetchBatchFromItad(apiKey, missingIds);
    return [...cached, ...fetched];
  }

  /** Check cache for each ID, return cached entries and uncached IDs. */
  private async checkBatchCache(ids: string[]): Promise<{
    cached: ItadOverviewGameEntry[];
    missingIds: string[];
  }> {
    const cached: ItadOverviewGameEntry[] = [];
    const missingIds: string[] = [];
    const results = await Promise.all(
      ids.map((id) => getCachedPrice<ItadOverviewGameEntry>(this.redis, id)),
    );
    for (let i = 0; i < ids.length; i++) {
      if (results[i]) cached.push(results[i]!);
      else missingIds.push(ids[i]);
    }
    return { cached, missingIds };
  }

  /** Fetch missing IDs from ITAD API and cache each result. */
  private async fetchBatchFromItad(
    apiKey: string,
    ids: string[],
  ): Promise<ItadOverviewGameEntry[]> {
    const response = await itadPost<ItadOverviewResponse>(
      '/games/overview/v2',
      { key: apiKey },
      ids,
    );
    if (!response?.prices?.length) return [];
    await Promise.all(
      response.prices.map((e) => setCachedPrice(this.redis, e.id, e)),
    );
    return response.prices;
  }

  /** Read API key from settings. Returns null if not configured. */
  private async getApiKey(): Promise<string | null> {
    const key = await this.settingsService.getItadApiKey();
    if (!key) {
      this.logger.warn(
        'ITAD API key not configured — Best Price and deal sections will be empty',
      );
    }
    return key;
  }
}
