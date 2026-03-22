import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { stripSearchPunctuation } from '../common/search.util';
import type { IgdbGameDto, GameDetailDto } from '@raid-ledger/contract';
import type { ActivityPeriod } from '@raid-ledger/contract';
import { SettingsService } from '../settings/settings.service';
import { SETTINGS_EVENTS } from '../settings/settings.types';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { IGDB_SYNC_QUEUE, IgdbSyncJobData } from './igdb-sync.constants';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { ItadService } from '../itad/itad.service';
import {
  IGDB_CONFIG,
  type IgdbApiGame,
  type SearchResult,
} from './igdb.constants';
import {
  mapApiGameToDbRow,
  mapDbRowToDetail,
  searchLocalGames,
  lookupGameById,
  lookupGameDetailById,
  fetchTwitchToken,
  upsertGamesFromApi,
  upsertSingleGameRow,
  backfillMissingCovers,
  queryNowPlaying,
  querySyncStatus,
  buildHealthStatus,
  queryGameActivity,
  toggleGameVisibility,
  banGameHelper,
  unbanGameHelper,
  hideAdultGamesHelper,
  refreshExistingGames,
  discoverPopularGames,
  clearDiscoveryCache,
  buildAdultThemeFilter,
  executeIgdbQuery,
  enrichSyncedGamesWithItad,
} from './igdb-helpers.barrel';
import { sortByRelevance } from './igdb-search-sort.helpers';
import {
  runSearchPipeline,
  startSearchRefresh,
  type SearchPipelineParams,
} from './igdb-search-pipeline.helpers';

@Injectable()
export class IgdbService {
  private readonly logger = new Logger(IgdbService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenFetchPromise: Promise<string> | null = null;
  private readonly inFlightSearches = new Map<string, Promise<SearchResult>>();
  private readonly inFlightRefreshes = new Map<string, Promise<void>>();
  private _syncInProgress = false;
  private _lastApiCallAt: Date | null = null;
  private _lastApiCallSuccess: boolean | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private readonly settingsService: SettingsService,
    @InjectQueue(IGDB_SYNC_QUEUE) private readonly syncQueue: Queue,
    private readonly cronJobService: CronJobService,
    private readonly itadService: ItadService,
  ) {}

  @OnEvent(SETTINGS_EVENTS.IGDB_UPDATED)
  handleIgdbConfigUpdate(config: unknown) {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenFetchPromise = null;
    if (config) {
      this.enqueueSync('config-update').catch((err) =>
        this.logger.error(`Failed to enqueue IGDB sync: ${err}`),
      );
    }
  }

  @Cron('50 0 */6 * * *', { name: 'IgdbService_handleScheduledSync' })
  async handleScheduledSync() {
    await this.cronJobService.executeWithTracking(
      'IgdbService_handleScheduledSync',
      async () => {
        const configured = await this.settingsService.isIgdbConfigured();
        if (!configured && !this.configService.get('IGDB_CLIENT_ID'))
          return false;
        await this.enqueueSync('scheduled');
      },
    );
  }

  async enqueueSync(trigger: IgdbSyncJobData['trigger']) {
    const jobId = `igdb-${trigger}-sync`;
    await this.syncQueue.add(
      'sync',
      { trigger },
      { jobId, removeOnComplete: 100, removeOnFail: 50 },
    );
    return { jobId };
  }

  async syncAllGames() {
    this._syncInProgress = true;
    try {
      const queryFn = (body: string) => this.queryIgdb(body);
      const themeFilter = buildAdultThemeFilter(
        await this.isAdultFilterEnabled(),
      );
      const refreshed = await refreshExistingGames(
        this.db,
        queryFn,
        themeFilter,
      );
      const discovered = await discoverPopularGames(
        this.db,
        queryFn,
        themeFilter,
      );
      const backfilled = await backfillMissingCovers(this.db, queryFn);
      const enriched = await enrichSyncedGamesWithItad(
        this.db,
        (id) => this.itadService.lookupBySteamAppId(id),
        (itadId) => this.itadService.getGameInfo(itadId),
      );
      await clearDiscoveryCache(this.redis);
      return { refreshed, discovered, backfilled, enriched };
    } finally {
      this._syncInProgress = false;
    }
  }

  private async resolveCredentials() {
    const dbConfig = await this.settingsService.getIgdbConfig();
    if (dbConfig) return dbConfig;
    const clientId = this.configService.get<string>('IGDB_CLIENT_ID');
    const clientSecret = this.configService.get<string>('IGDB_CLIENT_SECRET');
    if (!clientId || !clientSecret)
      throw new Error('IGDB credentials not configured');
    return { clientId, clientSecret };
  }

  mapDbRowToDetail(g: typeof schema.games.$inferSelect): GameDetailDto {
    return mapDbRowToDetail(g);
  }
  private normalizeQuery(q: string): string {
    return stripSearchPunctuation(q).toLowerCase().trim();
  }
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry)
      return this.accessToken;
    if (this.tokenFetchPromise) return this.tokenFetchPromise;
    this.tokenFetchPromise = (async () => {
      const { clientId, clientSecret } = await this.resolveCredentials();
      const { token, expiry } = await fetchTwitchToken(clientId, clientSecret);
      this.accessToken = token;
      this.tokenExpiry = expiry;
      return token;
    })();
    try {
      return await this.tokenFetchPromise;
    } finally {
      this.tokenFetchPromise = null;
    }
  }

  private buildPipelineParams(): SearchPipelineParams {
    return {
      db: this.db,
      redis: this.redis,
      itadService: this.itadService,
      resolveCredentials: () => this.resolveCredentials(),
      getAccessToken: () => this.getAccessToken(),
      clearToken: () => {
        this.accessToken = null;
        this.tokenExpiry = null;
      },
      getAdultFilter: () => this.isAdultFilterEnabled(),
      upsertGames: (g) => this.upsertGamesFromApi(g),
      normalizeQuery: (q) => this.normalizeQuery(q),
      getCacheKey: (q) => `igdb:search:${this.normalizeQuery(q)}`,
      queryIgdb: (body) => this.queryIgdb(body),
    };
  }

  async searchGames(query: string): Promise<SearchResult> {
    const normalized = this.normalizeQuery(query);
    const existing = this.inFlightSearches.get(normalized);
    if (existing) return existing;
    const params = this.buildPipelineParams();
    const promise = runSearchPipeline(params, query, normalized, (q, n, k) =>
      this._triggerSearchRefresh(q, n, k),
    )
      .then((r) => sortByRelevance(this.db, r, normalized))
      .finally(() => this.inFlightSearches.delete(normalized));
    this.inFlightSearches.set(normalized, promise);
    return promise;
  }

  private _triggerSearchRefresh(
    query: string,
    normalized: string,
    cacheKey: string,
  ): void {
    if (this.inFlightRefreshes.has(cacheKey)) return;
    const params = this.buildPipelineParams();
    const promise = startSearchRefresh(
      params,
      query,
      normalized,
      cacheKey,
    ).finally(() => this.inFlightRefreshes.delete(cacheKey));
    this.inFlightRefreshes.set(cacheKey, promise);
  }

  async searchLocalGames(query: string): Promise<SearchResult> {
    return searchLocalGames(this.db, query, await this.isAdultFilterEnabled());
  }
  async getGameById(id: number): Promise<IgdbGameDto | null> {
    return lookupGameById(this.db, id);
  }
  async getGameDetailById(id: number): Promise<GameDetailDto | null> {
    return lookupGameDetailById(this.db, id);
  }

  async queryIgdb(body: string): Promise<IgdbApiGame[]> {
    const token = await this.getAccessToken();
    const { clientId } = await this.resolveCredentials();
    try {
      const result = await executeIgdbQuery(body, clientId, token);
      this._lastApiCallAt = result.callAt;
      this._lastApiCallSuccess = true;
      return result.games;
    } catch (err) {
      this._lastApiCallAt = new Date();
      this._lastApiCallSuccess = false;
      throw err;
    }
  }

  async upsertGamesFromApi(apiGames: IgdbApiGame[]) {
    return upsertGamesFromApi(this.db, apiGames);
  }
  async getSyncStatus() {
    return querySyncStatus(this.db, this._syncInProgress);
  }

  getHealthStatus() {
    return buildHealthStatus({
      accessToken: this.accessToken,
      tokenExpiry: this.tokenExpiry,
      lastApiCallAt: this._lastApiCallAt,
      lastApiCallSuccess: this._lastApiCallSuccess,
    });
  }

  async getGameActivity(gameId: number, period: ActivityPeriod) {
    return queryGameActivity(this.db, gameId, period);
  }
  async getGameNowPlaying(gameId: number) {
    return queryNowPlaying(this.db, gameId);
  }
  get redisClient() {
    return this.redis;
  }
  get config() {
    return IGDB_CONFIG;
  }
  get database() {
    return this.db;
  }

  async isAdultFilterEnabled(): Promise<boolean> {
    return (
      (await this.settingsService.get(SETTING_KEYS.IGDB_FILTER_ADULT)) ===
      'true'
    );
  }

  async hideGame(id: number) {
    return toggleGameVisibility(this.db, id, true, 'hidden');
  }
  async unhideGame(id: number) {
    return toggleGameVisibility(this.db, id, false, 'unhidden');
  }
  async banGame(id: number) {
    return banGameHelper(this.db, id);
  }
  async hideAdultGames() {
    return hideAdultGamesHelper(this.db);
  }

  async unbanGame(id: number) {
    const result = await unbanGameHelper(this.db, id);
    if (!result.success || !result.igdbId) return result;
    try {
      const games = await this.queryIgdb(
        `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; where id = ${result.igdbId}; limit 1;`,
      );
      if (games.length > 0)
        await upsertSingleGameRow(this.db, mapApiGameToDbRow(games[0]));
    } catch (err) {
      this.logger.warn(`Failed to refresh after unban: ${err}`);
    }
    return result;
  }
}
