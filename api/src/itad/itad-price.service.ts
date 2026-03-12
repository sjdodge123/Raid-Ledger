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
  ItadOverviewEntry,
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
  async getOverview(itadGameId: string): Promise<ItadOverviewEntry | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    const cached = await getCachedPrice<ItadOverviewEntry>(
      this.redis,
      itadGameId,
    );
    if (cached) return cached;

    const response = await itadPost<ItadOverviewResponse>(
      '/games/overview/v2',
      { key: apiKey },
      [itadGameId],
    );

    if (!response) return null;

    const entry = response[itadGameId] ?? null;
    if (entry) {
      await setCachedPrice(this.redis, itadGameId, entry);
    }
    return entry;
  }

  /** Read API key from settings. Returns null if not configured. */
  private async getApiKey(): Promise<string | null> {
    const key = await this.settingsService.getItadApiKey();
    if (!key) {
      this.logger.debug('ITAD API key not configured');
    }
    return key;
  }
}
