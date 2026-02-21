import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, eq, ilike, inArray, not, or, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import {
  stripSearchPunctuation,
  buildWordMatchFilters,
} from '../common/search.util';
import {
  IgdbGameDto,
  GameDetailDto,
  IgdbSyncStatusDto,
  IgdbHealthStatusDto,
} from '@raid-ledger/contract';
import { SettingsService, SETTINGS_EVENTS } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { IGDB_SYNC_QUEUE, IgdbSyncJobData } from './igdb-sync.constants';
import { CronJobService } from '../cron-jobs/cron-job.service';

/** IGDB Theme IDs for adult content filtering */
const ADULT_THEME_IDS = [42, 39]; // 42 = Erotic, 39 = Sexual Content

/**
 * Keyword blocklist for adult content that IGDB may not tag with adult themes.
 * When the adult filter is enabled, games whose names contain any of these
 * keywords (case-insensitive) are excluded from search results.
 */
const ADULT_KEYWORDS = [
  'hentai',
  'porn',
  'xxx',
  'nsfw',
  'erotic',
  'lewd',
  'nude',
  'naked',
  'sex toy',
  'harem',
  'ecchi',
  'futanari',
  'waifu',
  'ahegao',
  'succubus',
  'brothel',
  'stripclub',
  'strip poker',
];

/** IGDB API game response structure (expanded for ROK-229) */
interface IgdbApiGame {
  id: number;
  name: string;
  slug: string;
  cover?: {
    image_id: string;
  };
  genres?: { id: number }[];
  themes?: { id: number }[];
  game_modes?: number[];
  platforms?: { id: number }[];
  summary?: string;
  rating?: number;
  aggregated_rating?: number;
  total_rating?: number;
  screenshots?: { image_id: string }[];
  videos?: { name: string; video_id: string }[];
  first_release_date?: number;
  multiplayer_modes?: {
    onlinemax?: number;
    offlinemax?: number;
    onlinecoop?: boolean;
    offlinecoop?: boolean;
    lancoop?: boolean;
    splitscreen?: boolean;
    platform?: number;
  }[];
  external_games?: { category: number; uid: string }[];
}

/** Search result with source tracking */
export interface SearchResult {
  games: GameDetailDto[];
  cached: boolean;
  source: 'redis' | 'database' | 'igdb' | 'local';
}

/** Constants for IGDB integration */
const IGDB_CONFIG = {
  /** Buffer time before token expiry (seconds) */
  TOKEN_EXPIRY_BUFFER: 300,
  /** Maximum games to return per search */
  SEARCH_LIMIT: 20,
  /** IGDB cover image base URL */
  COVER_URL_BASE: 'https://images.igdb.com/igdb/image/upload/t_cover_big',
  /** IGDB screenshot image base URL */
  SCREENSHOT_URL_BASE:
    'https://images.igdb.com/igdb/image/upload/t_screenshot_big',
  /** Redis cache TTL for search results (24 hours) */
  SEARCH_CACHE_TTL: 86400,
  /** Redis cache TTL for discovery rows (1 hour) */
  DISCOVER_CACHE_TTL: 3600,
  /** Redis cache TTL for streams (5 minutes) */
  STREAMS_CACHE_TTL: 300,
  /** Maximum retry attempts for 429 errors */
  MAX_RETRIES: 3,
  /** Base delay for exponential backoff (ms) */
  BASE_RETRY_DELAY: 1000,
  /** Twitch external game category ID in IGDB */
  TWITCH_CATEGORY_ID: 14,
  /** Expanded APICALYPSE fields for discovery */
  EXPANDED_FIELDS: [
    'name',
    'slug',
    'cover.image_id',
    'genres.id',
    'themes.id',
    'game_modes',
    'platforms.id',
    'summary',
    'rating',
    'aggregated_rating',
    'total_rating',
    'screenshots.image_id',
    'videos.name',
    'videos.video_id',
    'first_release_date',
    'multiplayer_modes.*',
    'external_games.category',
    'external_games.uid',
  ].join(', '),
} as const;

@Injectable()
export class IgdbService {
  private readonly logger = new Logger(IgdbService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenFetchPromise: Promise<string> | null = null;

  // ROK-173: Sync & health tracking
  private _syncInProgress = false;
  private _lastApiCallAt: Date | null = null;
  private _lastApiCallSuccess: boolean | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT)
    private redis: Redis,
    private readonly settingsService: SettingsService,
    @InjectQueue(IGDB_SYNC_QUEUE) private readonly syncQueue: Queue,
    private readonly cronJobService: CronJobService,
  ) {}

  /**
   * Handle IGDB config updates — clear cached token so next request
   * picks up new credentials, then trigger an immediate sync.
   */
  @OnEvent(SETTINGS_EVENTS.IGDB_UPDATED)
  handleIgdbConfigUpdate(config: unknown) {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenFetchPromise = null;
    this.logger.debug('IGDB config updated — cached token cleared');

    // Trigger immediate sync when credentials are set (not cleared)
    if (config) {
      this.enqueueSync('config-update').catch((err) =>
        this.logger.error(`Failed to enqueue IGDB sync: ${err}`),
      );
    }
  }

  /**
   * Scheduled sync: refresh game data from IGDB every 6 hours.
   * Only runs when IGDB credentials are configured.
   */
  @Cron(CronExpression.EVERY_6_HOURS, {
    name: 'IgdbService_handleScheduledSync',
  })
  async handleScheduledSync() {
    await this.cronJobService.executeWithTracking(
      'IgdbService_handleScheduledSync',
      async () => {
        const configured = await this.settingsService.isIgdbConfigured();
        if (!configured) {
          // Also check env vars
          const clientId = this.configService.get<string>('IGDB_CLIENT_ID');
          if (!clientId) return;
        }

        this.logger.log('Enqueuing scheduled IGDB sync...');
        await this.enqueueSync('scheduled');
      },
    );
  }

  /**
   * Enqueue an IGDB sync job. Uses a fixed jobId per trigger to prevent
   * duplicate concurrent syncs of the same type.
   */
  async enqueueSync(
    trigger: IgdbSyncJobData['trigger'],
  ): Promise<{ jobId: string }> {
    const jobId = `igdb-${trigger}-sync`;
    await this.syncQueue.add(
      'sync',
      { trigger },
      {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    return { jobId };
  }

  /**
   * Full sync: refresh all existing games + pull popular multiplayer titles.
   * Called by scheduled cron and on initial IGDB config.
   */
  async syncAllGames(): Promise<{ refreshed: number; discovered: number }> {
    this._syncInProgress = true;
    try {
      return await this._doSync();
    } finally {
      this._syncInProgress = false;
    }
  }

  private async _doSync(): Promise<{ refreshed: number; discovered: number }> {
    let refreshed = 0;
    let discovered = 0;

    // Check adult content filter setting
    const adultFilterEnabled = await this.isAdultFilterEnabled();
    const adultThemeFilter = adultFilterEnabled
      ? ` & themes != (${ADULT_THEME_IDS.join(',')})`
      : '';

    // Phase 1: Refresh existing non-hidden, non-banned games in batches of 10 by IGDB ID
    const existingGames = await this.db
      .select({ igdbId: schema.games.igdbId })
      .from(schema.games)
      .where(
        and(eq(schema.games.hidden, false), eq(schema.games.banned, false)),
      );

    if (existingGames.length > 0) {
      const batchSize = 10;
      for (let i = 0; i < existingGames.length; i += batchSize) {
        const batch = existingGames.slice(i, i + batchSize);
        const ids = batch.map((g) => g.igdbId).join(',');

        try {
          const apiGames = await this.queryIgdb(
            `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; where id = (${ids})${adultThemeFilter}; limit ${batchSize};`,
          );
          await this.upsertGamesFromApi(apiGames);
          refreshed += apiGames.length;
        } catch (err) {
          this.logger.warn(
            `Failed to refresh batch starting at index ${i}: ${err}`,
          );
        }

        // Rate limit: small delay between batches
        await this.delay(250);
      }
    }

    // Phase 2: Discover popular multiplayer games
    try {
      const popular = await this.queryIgdb(
        `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; ` +
          `where game_modes = (2,3,5) & rating_count > 10${adultThemeFilter}; ` +
          `sort total_rating desc; limit 100;`,
      );
      await this.upsertGamesFromApi(popular);
      discovered = popular.length;
    } catch (err) {
      this.logger.warn(`Failed to discover popular games: ${err}`);
    }

    this.logger.log(
      `IGDB sync: refreshed ${refreshed} existing games, discovered ${discovered} popular titles`,
    );

    // Clear discovery cache so fresh data shows up
    try {
      const keys = await this.redis.keys('games:discover:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch {
      // Non-fatal
    }

    return { refreshed, discovered };
  }

  /**
   * Resolve IGDB credentials: DB-stored settings first, env vars as fallback.
   */
  private async resolveCredentials(): Promise<{
    clientId: string;
    clientSecret: string;
  }> {
    // Try DB settings first
    const dbConfig = await this.settingsService.getIgdbConfig();
    if (dbConfig) {
      return dbConfig;
    }

    // Fall back to env vars
    const clientId = this.configService.get<string>('IGDB_CLIENT_ID');
    const clientSecret = this.configService.get<string>('IGDB_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('IGDB credentials not configured');
    }

    return { clientId, clientSecret };
  }

  /**
   * Map an IGDB API game response to a database insert row.
   */
  mapApiGameToDbRow(game: IgdbApiGame) {
    // Extract Twitch category ID from external_games
    const twitchExternal = game.external_games?.find(
      (eg) => eg.category === IGDB_CONFIG.TWITCH_CATEGORY_ID,
    );

    // Extract player count from multiplayer_modes
    let playerCount: { min: number; max: number } | null = null;
    let crossplay: boolean | null = null;
    if (game.multiplayer_modes && game.multiplayer_modes.length > 0) {
      const maxPlayers = Math.max(
        ...game.multiplayer_modes.map((m) =>
          Math.max(m.onlinemax ?? 0, m.offlinemax ?? 0),
        ),
      );
      if (maxPlayers > 0) {
        playerCount = { min: 1, max: maxPlayers };
      }

      // Infer crossplay: online play available on 2+ distinct platforms
      const platformsWithOnline = new Set(
        game.multiplayer_modes
          .filter((m) => (m.onlinemax ?? 0) > 0 && m.platform)
          .map((m) => m.platform),
      );
      if (platformsWithOnline.size >= 2) {
        crossplay = true;
      }
    }

    return {
      igdbId: game.id,
      name: game.name,
      slug: game.slug,
      coverUrl: game.cover
        ? `${IGDB_CONFIG.COVER_URL_BASE}/${game.cover.image_id}.jpg`
        : null,
      genres: game.genres?.map((g) => g.id) ?? [],
      summary: game.summary ?? null,
      rating: game.rating ?? null,
      aggregatedRating: game.aggregated_rating ?? null,
      popularity: game.total_rating ?? null,
      gameModes: game.game_modes ?? [],
      themes: game.themes?.map((t) => t.id) ?? [],
      platforms: game.platforms?.map((p) => p.id) ?? [],
      screenshots:
        game.screenshots?.map(
          (s) => `${IGDB_CONFIG.SCREENSHOT_URL_BASE}/${s.image_id}.jpg`,
        ) ?? [],
      videos:
        game.videos?.map((v) => ({
          name: v.name,
          videoId: v.video_id,
        })) ?? [],
      firstReleaseDate: game.first_release_date
        ? new Date(game.first_release_date * 1000)
        : null,
      playerCount,
      twitchGameId: twitchExternal?.uid ?? null,
      crossplay,
    };
  }

  /**
   * Map a database game row to a GameDetailDto.
   */
  mapDbRowToDetail(g: typeof schema.games.$inferSelect): GameDetailDto {
    return {
      id: g.id,
      igdbId: g.igdbId,
      name: g.name,
      slug: g.slug,
      coverUrl: g.coverUrl,
      genres: (g.genres as number[]) ?? [],
      summary: g.summary,
      rating: g.rating,
      aggregatedRating: g.aggregatedRating,
      popularity: g.popularity,
      gameModes: (g.gameModes as number[]) ?? [],
      themes: (g.themes as number[]) ?? [],
      platforms: (g.platforms as number[]) ?? [],
      screenshots: (g.screenshots as string[]) ?? [],
      videos: (g.videos as { name: string; videoId: string }[]) ?? [],
      firstReleaseDate: g.firstReleaseDate
        ? g.firstReleaseDate.toISOString()
        : null,
      playerCount: g.playerCount as { min: number; max: number } | null,
      twitchGameId: g.twitchGameId,
      crossplay: g.crossplay ?? null,
    };
  }

  /**
   * Normalize query for consistent cache keys.
   * Strips punctuation so "halo: combat" and "halo combat" share the
   * same cache key.
   * @param query - Raw search query
   * @returns Normalized query (lowercase, trimmed, punctuation-stripped)
   */
  private normalizeQuery(query: string): string {
    return stripSearchPunctuation(query).toLowerCase().trim();
  }

  /**
   * Generate Redis cache key for a search query
   * @param query - Normalized search query
   * @returns Redis key
   */
  private getCacheKey(query: string): string {
    return `igdb:search:${this.normalizeQuery(query)}`;
  }

  /**
   * Delay helper for retry logic
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get OAuth2 access token from Twitch (IGDB uses Twitch auth).
   * Uses single-flight pattern to prevent concurrent token fetches.
   * @returns Valid access token
   * @throws Error if credentials not configured or auth fails
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Single-flight: reuse in-flight request if one exists
    if (this.tokenFetchPromise) {
      return this.tokenFetchPromise;
    }

    this.tokenFetchPromise = this.fetchNewToken();

    try {
      const token = await this.tokenFetchPromise;
      return token;
    } finally {
      this.tokenFetchPromise = null;
    }
  }

  /**
   * Fetch a new OAuth2 token from Twitch
   */
  private async fetchNewToken(): Promise<string> {
    const { clientId, clientSecret } = await this.resolveCredentials();

    // Use POST body instead of query string for secrets (security best practice)
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Failed to get IGDB access token: ${response.status} ${errorText}`,
      );
      throw new Error(
        `Failed to get IGDB access token: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.accessToken = data.access_token;
    // Set expiry with buffer time before actual expiry for safety
    this.tokenExpiry = new Date(
      Date.now() + (data.expires_in - IGDB_CONFIG.TOKEN_EXPIRY_BUFFER) * 1000,
    );

    this.logger.debug('IGDB access token refreshed');
    return this.accessToken;
  }

  /**
   * Search games by name with multi-layer caching strategy:
   * 1. Check Redis cache for this exact query
   * 2. Check local database
   * 3. Fetch from IGDB API with retry logic
   * 4. Fall back to local search on failure
   *
   * @param query - Search query string
   * @returns Object containing games array and source info
   */
  async searchGames(query: string): Promise<SearchResult> {
    const normalizedQuery = this.normalizeQuery(query);
    const cacheKey = this.getCacheKey(query);

    // Build DB filters for hidden/banned/adult (reused across layers)
    const adultFilterEnabled = await this.isAdultFilterEnabled();
    const dbFilters = [
      ...buildWordMatchFilters(schema.games.name, normalizedQuery),
      eq(schema.games.hidden, false),
      eq(schema.games.banned, false),
    ];
    if (adultFilterEnabled) {
      dbFilters.push(...this.buildAdultFilters());
    }

    // Layer 1: Check Redis cache — re-query DB with filters to enforce ban/hide/adult
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`Redis cache hit for query: ${query}`);
        const cachedIds = (JSON.parse(cached) as { id: number }[]).map(
          (g) => g.id,
        );
        if (cachedIds.length > 0) {
          const freshRows = await this.db
            .select()
            .from(schema.games)
            .where(
              and(
                inArray(schema.games.id, cachedIds),
                eq(schema.games.hidden, false),
                eq(schema.games.banned, false),
                ...(adultFilterEnabled ? this.buildAdultFilters() : []),
              ),
            )
            .limit(IGDB_CONFIG.SEARCH_LIMIT);

          return {
            games: freshRows.map((g) => this.mapDbRowToDetail(g)),
            cached: true,
            source: 'redis',
          };
        }
        // Cached IDs empty — fall through to DB/IGDB layers
      }
      this.logger.debug(`Redis cache miss for query: ${query}`);
    } catch (redisError) {
      this.logger.warn(`Redis error, falling back: ${redisError}`);
      // Continue to next layer if Redis fails
    }

    // Layer 2: Check local database (exclude hidden/banned games + adult filter)
    const cachedGames = await this.db
      .select()
      .from(schema.games)
      .where(and(...dbFilters))
      .limit(IGDB_CONFIG.SEARCH_LIMIT);

    if (cachedGames.length >= IGDB_CONFIG.SEARCH_LIMIT) {
      this.logger.debug(`Database cache hit (full page) for query: ${query}`);
      const games = cachedGames.map((g) => this.mapDbRowToDetail(g));

      // Cache in Redis for future requests (only non-empty results)
      await this.cacheToRedis(cacheKey, games);

      return {
        games,
        cached: true,
        source: 'database',
      };
    }

    // Layer 3: Fetch from IGDB (DB had < SEARCH_LIMIT results, try to find more)
    try {
      const igdbGames = await this.fetchWithRetry(normalizedQuery);

      // Upsert games with full expanded data from IGDB
      if (igdbGames.length > 0) {
        await this.upsertGamesFromApi(igdbGames);
      }

      // Return freshly cached games (exclude hidden + adult filter)
      const freshGames = await this.db
        .select()
        .from(schema.games)
        .where(and(...dbFilters))
        .limit(IGDB_CONFIG.SEARCH_LIMIT);

      const games = freshGames.map((g) => this.mapDbRowToDetail(g));

      // Cache in Redis for future requests (only non-empty to prevent cache poisoning)
      if (games.length > 0) {
        await this.cacheToRedis(cacheKey, games);
      }

      return {
        games,
        cached: false,
        source: 'igdb',
      };
    } catch (error) {
      // Layer 4: Fall back to local search on IGDB failure
      this.logger.warn(
        `IGDB fetch failed, falling back to local search: ${error}`,
      );
      return this.searchLocalGames(normalizedQuery);
    }
  }

  /**
   * Cache search results to Redis
   * @param key - Redis cache key
   * @param games - Games to cache
   */
  private async cacheToRedis(
    key: string,
    games: GameDetailDto[],
  ): Promise<void> {
    try {
      await this.redis.setex(
        key,
        IGDB_CONFIG.SEARCH_CACHE_TTL,
        JSON.stringify(games),
      );
      this.logger.debug(`Cached ${games.length} games to Redis`);
    } catch (error) {
      this.logger.warn(`Failed to cache to Redis: ${error}`);
      // Non-fatal: continue without caching
    }
  }

  /**
   * Search local games database as fallback
   * @param query - Search query
   * @returns Local search results
   */
  async searchLocalGames(query: string): Promise<SearchResult> {
    const adultFilterEnabled = await this.isAdultFilterEnabled();

    const filters = [
      ...buildWordMatchFilters(schema.games.name, query),
      eq(schema.games.hidden, false),
      eq(schema.games.banned, false),
    ];
    if (adultFilterEnabled) {
      filters.push(...this.buildAdultFilters());
    }

    const localGames = await this.db
      .select()
      .from(schema.games)
      .where(and(...filters))
      .limit(IGDB_CONFIG.SEARCH_LIMIT);

    this.logger.debug(`Local search found ${localGames.length} games`);

    return {
      games: localGames.map((g) => this.mapDbRowToDetail(g)),
      cached: true,
      source: 'local',
    };
  }

  /**
   * Fetch games from IGDB API with retry logic for rate limiting (429).
   * Uses exponential backoff: 1s, 2s, 4s delays.
   *
   * @param query - Search query string
   * @param attempt - Current attempt number (starts at 1)
   * @returns Array of games from IGDB
   * @throws Error if all retries exhausted or non-recoverable error
   */
  private async fetchWithRetry(
    query: string,
    attempt = 1,
  ): Promise<IgdbApiGame[]> {
    try {
      return await this.fetchFromIgdb(query);
    } catch (error: unknown) {
      const is429 = error instanceof Error && error.message.includes('429');

      if (is429 && attempt < IGDB_CONFIG.MAX_RETRIES) {
        const delay = Math.pow(2, attempt - 1) * IGDB_CONFIG.BASE_RETRY_DELAY;
        this.logger.warn(
          `IGDB 429 rate limit, retrying in ${delay}ms (attempt ${attempt}/${IGDB_CONFIG.MAX_RETRIES})`,
        );
        await this.delay(delay);
        return this.fetchWithRetry(query, attempt + 1);
      }

      // Log final failure
      if (is429) {
        this.logger.error(
          `IGDB rate limit: max retries (${IGDB_CONFIG.MAX_RETRIES}) exhausted`,
        );
      }

      throw error;
    }
  }

  /**
   * Fetch games from IGDB API.
   * @param query - Search query string
   * @returns Array of games from IGDB
   * @throws Error if API call fails (including 429)
   */
  private async fetchFromIgdb(query: string): Promise<IgdbApiGame[]> {
    const token = await this.getAccessToken();
    const { clientId } = await this.resolveCredentials();

    // Escape quotes in query to prevent APICALYPSE injection
    const sanitizedQuery = query.replace(/"/g, '\\"');

    // Apply adult content filter if enabled
    const adultFilterEnabled = await this.isAdultFilterEnabled();
    const adultWhereClause = adultFilterEnabled
      ? ` where themes != (${ADULT_THEME_IDS.join(',')});`
      : '';

    const body = `search "${sanitizedQuery}"; fields ${IGDB_CONFIG.EXPANDED_FIELDS};${adultWhereClause} limit ${IGDB_CONFIG.SEARCH_LIMIT};`;
    this.logger.debug(`IGDB search query: ${body}`);

    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`IGDB API error: ${response.status} ${errorText}`);
      throw new Error(
        `IGDB API error ${response.status}: ${response.statusText}`,
      );
    }

    const results = (await response.json()) as IgdbApiGame[];
    this.logger.debug(
      `IGDB search returned ${results.length} results for "${query}"`,
    );
    return results;
  }

  /**
   * Get a single game by its local database ID.
   * @param id - Local database ID
   * @returns Game DTO or null if not found
   */
  async getGameById(id: number): Promise<IgdbGameDto | null> {
    const result = await this.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (result.length === 0) return null;

    const g = result[0];
    return {
      id: g.id,
      igdbId: g.igdbId,
      name: g.name,
      slug: g.slug,
      coverUrl: g.coverUrl,
    };
  }

  /**
   * Get full game detail by local database ID.
   */
  async getGameDetailById(id: number): Promise<GameDetailDto | null> {
    const result = await this.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (result.length === 0) return null;
    return this.mapDbRowToDetail(result[0]);
  }

  /**
   * Execute an arbitrary APICALYPSE query against IGDB.
   * Used by discovery endpoints for category-specific queries.
   */
  async queryIgdb(body: string): Promise<IgdbApiGame[]> {
    const token = await this.getAccessToken();
    const { clientId } = await this.resolveCredentials();

    try {
      const response = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`IGDB API error: ${response.status} ${errorText}`);
        this._lastApiCallAt = new Date();
        this._lastApiCallSuccess = false;
        throw new Error(
          `IGDB API error ${response.status}: ${response.statusText}`,
        );
      }

      this._lastApiCallAt = new Date();
      this._lastApiCallSuccess = true;
      return (await response.json()) as IgdbApiGame[];
    } catch (err) {
      this._lastApiCallAt = new Date();
      this._lastApiCallSuccess = false;
      throw err;
    }
  }

  /**
   * Upsert games from IGDB API responses into the local database.
   * Skips games whose igdbId is banned (tombstoned).
   * Returns the inserted/existing game rows as detail DTOs.
   */
  async upsertGamesFromApi(apiGames: IgdbApiGame[]): Promise<GameDetailDto[]> {
    if (apiGames.length === 0) return [];

    // Look up banned igdbIds to skip them during discovery
    const incomingIgdbIds = apiGames.map((g) => g.id);
    const bannedRows = await this.db
      .select({ igdbId: schema.games.igdbId })
      .from(schema.games)
      .where(
        and(
          inArray(schema.games.igdbId, incomingIgdbIds),
          eq(schema.games.banned, true),
        ),
      );
    const bannedIgdbIds = new Set(bannedRows.map((r) => r.igdbId));

    const filteredGames = apiGames.filter((g) => !bannedIgdbIds.has(g.id));
    if (filteredGames.length === 0) return [];

    const rows = filteredGames.map((g) => this.mapApiGameToDbRow(g));

    // Use onConflictDoUpdate to refresh expanded data
    for (const row of rows) {
      await this.db
        .insert(schema.games)
        .values(row)
        .onConflictDoUpdate({
          target: schema.games.igdbId,
          set: {
            name: row.name,
            slug: row.slug,
            coverUrl: row.coverUrl,
            genres: row.genres,
            summary: row.summary,
            rating: row.rating,
            aggregatedRating: row.aggregatedRating,
            popularity: row.popularity,
            gameModes: row.gameModes,
            themes: row.themes,
            platforms: row.platforms,
            screenshots: row.screenshots,
            videos: row.videos,
            firstReleaseDate: row.firstReleaseDate,
            playerCount: row.playerCount,
            twitchGameId: row.twitchGameId,
            cachedAt: new Date(),
          },
        });
    }

    // Fetch the upserted rows
    const igdbIds = rows.map((r) => r.igdbId);
    const results = await this.db
      .select()
      .from(schema.games)
      .where(inArray(schema.games.igdbId, igdbIds));

    return results.map((g) => this.mapDbRowToDetail(g));
  }

  /**
   * ROK-173: Get sync status for admin panel.
   */
  async getSyncStatus(): Promise<IgdbSyncStatusDto> {
    const result = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        lastSync: sql<string | null>`max(${schema.games.cachedAt})::text`,
      })
      .from(schema.games);

    const row = result[0];
    return {
      lastSyncAt: row?.lastSync ?? null,
      gameCount: row?.count ?? 0,
      syncInProgress: this._syncInProgress,
    };
  }

  /**
   * ROK-173: Get connection health status for admin panel.
   */
  getHealthStatus(): IgdbHealthStatusDto {
    let tokenStatus: 'valid' | 'expired' | 'not_fetched' = 'not_fetched';
    if (this.accessToken && this.tokenExpiry) {
      tokenStatus = new Date() < this.tokenExpiry ? 'valid' : 'expired';
    }

    return {
      tokenStatus,
      tokenExpiresAt: this.tokenExpiry?.toISOString() ?? null,
      lastApiCallAt: this._lastApiCallAt?.toISOString() ?? null,
      lastApiCallSuccess: this._lastApiCallSuccess,
    };
  }

  /** Expose Redis client and config for controller use */
  get redisClient() {
    return this.redis;
  }

  get config() {
    return IGDB_CONFIG;
  }

  /** Expose DB for controller queries */
  get database() {
    return this.db;
  }

  // ============================================================
  // ROK-231: Game hide/ban + adult content filter
  // ============================================================

  /**
   * Check if the adult content filter setting is enabled.
   */
  async isAdultFilterEnabled(): Promise<boolean> {
    const value = await this.settingsService.get(
      SETTING_KEYS.IGDB_FILTER_ADULT,
    );
    return value === 'true';
  }

  /**
   * Build Drizzle SQL filters for adult content (themes + keyword blocklist).
   * Returns an array of conditions to spread into an `and()` clause.
   */
  private buildAdultFilters(): ReturnType<typeof sql>[] {
    return [
      // Block games tagged with adult themes (Erotic, Sexual Content)
      sql`NOT (${schema.games.themes}::jsonb @> ANY(ARRAY[${sql.raw(ADULT_THEME_IDS.map((id) => `'[${id}]'::jsonb`).join(','))}]))`,
      // Block games whose names contain adult keywords
      not(
        or(...ADULT_KEYWORDS.map((kw) => ilike(schema.games.name, `%${kw}%`)))!,
      ),
    ];
  }

  /**
   * Hide a game by ID. Hidden games are excluded from user-facing search/discovery
   * and are not re-imported during IGDB sync.
   */
  async hideGame(
    id: number,
  ): Promise<{ success: boolean; message: string; name: string }> {
    const existing = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (existing.length === 0) {
      return { success: false, message: 'Game not found', name: '' };
    }

    await this.db
      .update(schema.games)
      .set({ hidden: true })
      .where(eq(schema.games.id, id));

    this.logger.log(
      `Game "${existing[0].name}" (id=${id}) hidden via admin UI`,
    );

    return {
      success: true,
      message: `Game "${existing[0].name}" hidden from users.`,
      name: existing[0].name,
    };
  }

  /**
   * Unhide a previously hidden game.
   */
  async unhideGame(
    id: number,
  ): Promise<{ success: boolean; message: string; name: string }> {
    const existing = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (existing.length === 0) {
      return { success: false, message: 'Game not found', name: '' };
    }

    await this.db
      .update(schema.games)
      .set({ hidden: false })
      .where(eq(schema.games.id, id));

    this.logger.log(
      `Game "${existing[0].name}" (id=${id}) unhidden via admin UI`,
    );

    return {
      success: true,
      message: `Game "${existing[0].name}" is now visible to users.`,
      name: existing[0].name,
    };
  }

  /**
   * Ban a game by ID. Banned games are tombstoned — excluded from sync,
   * search, and discovery, and will not be re-imported by IGDB sync.
   */
  async banGame(
    id: number,
  ): Promise<{ success: boolean; message: string; name: string }> {
    const existing = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (existing.length === 0) {
      return { success: false, message: 'Game not found', name: '' };
    }

    await this.db
      .update(schema.games)
      .set({ banned: true, hidden: true })
      .where(eq(schema.games.id, id));

    this.logger.log(
      `Game "${existing[0].name}" (id=${id}) banned via admin UI`,
    );

    return {
      success: true,
      message: `Game "${existing[0].name}" has been banned.`,
      name: existing[0].name,
    };
  }

  /**
   * Unban a previously banned game, then force a fresh IGDB import
   * to restore its data.
   */
  async unbanGame(
    id: number,
  ): Promise<{ success: boolean; message: string; name: string }> {
    const existing = await this.db
      .select({
        id: schema.games.id,
        name: schema.games.name,
        igdbId: schema.games.igdbId,
      })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (existing.length === 0) {
      return { success: false, message: 'Game not found', name: '' };
    }

    await this.db
      .update(schema.games)
      .set({ banned: false, hidden: false })
      .where(eq(schema.games.id, id));

    // Force a fresh IGDB import to restore full data
    try {
      await this.fetchAndUpsertSingleGame(existing[0].igdbId);
    } catch (err) {
      this.logger.warn(`Failed to refresh game data after unban: ${err}`);
    }

    this.logger.log(
      `Game "${existing[0].name}" (id=${id}) unbanned via admin UI`,
    );

    return {
      success: true,
      message: `Game "${existing[0].name}" has been unbanned and restored.`,
      name: existing[0].name,
    };
  }

  /**
   * Fetch a single game from IGDB by its IGDB ID and upsert it.
   * Used to restore data after unbanning.
   */
  async fetchAndUpsertSingleGame(igdbId: number): Promise<void> {
    const apiGames = await this.queryIgdb(
      `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; where id = ${igdbId}; limit 1;`,
    );
    if (apiGames.length > 0) {
      const row = this.mapApiGameToDbRow(apiGames[0]);
      await this.db
        .insert(schema.games)
        .values(row)
        .onConflictDoUpdate({
          target: schema.games.igdbId,
          set: {
            name: row.name,
            slug: row.slug,
            coverUrl: row.coverUrl,
            genres: row.genres,
            summary: row.summary,
            rating: row.rating,
            aggregatedRating: row.aggregatedRating,
            popularity: row.popularity,
            gameModes: row.gameModes,
            themes: row.themes,
            platforms: row.platforms,
            screenshots: row.screenshots,
            videos: row.videos,
            firstReleaseDate: row.firstReleaseDate,
            playerCount: row.playerCount,
            twitchGameId: row.twitchGameId,
            cachedAt: new Date(),
          },
        });
    }
  }

  /**
   * Auto-hide games with adult themes (one-time sweep).
   * Called when the adult content filter is first enabled.
   */
  async hideAdultGames(): Promise<number> {
    const result = await this.db
      .update(schema.games)
      .set({ hidden: true })
      .where(
        and(
          eq(schema.games.hidden, false),
          or(
            sql`${schema.games.themes}::jsonb @> ANY(ARRAY[${sql.raw(ADULT_THEME_IDS.map((id) => `'[${id}]'::jsonb`).join(','))}])`,
            or(
              ...ADULT_KEYWORDS.map((kw) =>
                ilike(schema.games.name, `%${kw}%`),
              ),
            ),
          ),
        ),
      )
      .returning({ id: schema.games.id });

    if (result.length > 0) {
      this.logger.log(
        `Auto-hidden ${result.length} games with adult themes/keywords`,
      );
    }

    return result.length;
  }
}
