import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, ilike, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import {
  IgdbGameDto,
  GameDetailDto,
  IgdbSyncStatusDto,
  IgdbHealthStatusDto,
} from '@raid-ledger/contract';
import { SettingsService, SETTINGS_EVENTS } from '../settings/settings.service';

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
  games: IgdbGameDto[];
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
    this.logger.log('IGDB config updated — cached token cleared');

    // Trigger immediate sync when credentials are set (not cleared)
    if (config) {
      this.syncAllGames().catch((err) =>
        this.logger.error(`Initial IGDB sync failed: ${err}`),
      );
    }
  }

  /**
   * Scheduled sync: refresh game data from IGDB every 6 hours.
   * Only runs when IGDB credentials are configured.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async handleScheduledSync() {
    const configured = await this.settingsService.isIgdbConfigured();
    if (!configured) {
      // Also check env vars
      const clientId = this.configService.get<string>('IGDB_CLIENT_ID');
      if (!clientId) return;
    }

    this.logger.log('Starting scheduled IGDB sync...');
    try {
      await this.syncAllGames();
      this.logger.log('Scheduled IGDB sync complete');
    } catch (err) {
      this.logger.error(`Scheduled IGDB sync failed: ${err}`);
    }
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

    // Phase 1: Refresh existing games in batches of 10 by IGDB ID
    const existingGames = await this.db
      .select({ igdbId: schema.games.igdbId })
      .from(schema.games);

    if (existingGames.length > 0) {
      const batchSize = 10;
      for (let i = 0; i < existingGames.length; i += batchSize) {
        const batch = existingGames.slice(i, i + batchSize);
        const ids = batch.map((g) => g.igdbId).join(',');

        try {
          const apiGames = await this.queryIgdb(
            `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; where id = (${ids}); limit ${batchSize};`,
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
          `where game_modes = (2,3,5) & rating_count > 10; ` +
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
   * Escape special characters in LIKE/ILIKE patterns to prevent injection
   * @param input - User input string to escape
   * @returns Escaped string safe for LIKE patterns
   */
  private escapeLikePattern(input: string): string {
    return input.replace(/[%_\\]/g, '\\$&');
  }

  /**
   * Normalize query for consistent cache keys
   * @param query - Raw search query
   * @returns Normalized query (lowercase, trimmed)
   */
  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim();
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

    this.logger.log('IGDB access token refreshed');
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

    // Layer 1: Check Redis cache
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`Redis cache hit for query: ${query}`);
        return {
          games: JSON.parse(cached) as IgdbGameDto[],
          cached: true,
          source: 'redis',
        };
      }
      this.logger.debug(`Redis cache miss for query: ${query}`);
    } catch (redisError) {
      this.logger.warn(`Redis error, falling back: ${redisError}`);
      // Continue to next layer if Redis fails
    }

    // Layer 2: Check local database
    const escapedQuery = this.escapeLikePattern(normalizedQuery);
    const cachedGames = await this.db
      .select()
      .from(schema.games)
      .where(ilike(schema.games.name, `%${escapedQuery}%`))
      .limit(IGDB_CONFIG.SEARCH_LIMIT);

    if (cachedGames.length > 0) {
      this.logger.debug(`Database cache hit for query: ${query}`);
      const games = cachedGames.map((g) => ({
        id: g.id,
        igdbId: g.igdbId,
        name: g.name,
        slug: g.slug,
        coverUrl: g.coverUrl,
      }));

      // Cache in Redis for future requests
      await this.cacheToRedis(cacheKey, games);

      return {
        games,
        cached: true,
        source: 'database',
      };
    }

    // Layer 3: Fetch from IGDB with retry logic
    try {
      const igdbGames = await this.fetchWithRetry(normalizedQuery);

      // Upsert games with full expanded data from IGDB
      if (igdbGames.length > 0) {
        await this.upsertGamesFromApi(igdbGames);
      }

      // Return freshly cached games
      const freshGames = await this.db
        .select()
        .from(schema.games)
        .where(ilike(schema.games.name, `%${escapedQuery}%`))
        .limit(IGDB_CONFIG.SEARCH_LIMIT);

      const games = freshGames.map((g) => ({
        id: g.id,
        igdbId: g.igdbId,
        name: g.name,
        slug: g.slug,
        coverUrl: g.coverUrl,
      }));

      // Cache in Redis for future requests
      await this.cacheToRedis(cacheKey, games);

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
  private async cacheToRedis(key: string, games: IgdbGameDto[]): Promise<void> {
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
    const escapedQuery = this.escapeLikePattern(query);

    const localGames = await this.db
      .select()
      .from(schema.games)
      .where(ilike(schema.games.name, `%${escapedQuery}%`))
      .limit(IGDB_CONFIG.SEARCH_LIMIT);

    this.logger.debug(`Local search found ${localGames.length} games`);

    return {
      games: localGames.map((g) => ({
        id: g.id,
        igdbId: g.igdbId,
        name: g.name,
        slug: g.slug,
        coverUrl: g.coverUrl,
      })),
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

    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: `search "${sanitizedQuery}"; fields ${IGDB_CONFIG.EXPANDED_FIELDS}; limit ${IGDB_CONFIG.SEARCH_LIMIT};`,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`IGDB API error: ${response.status} ${errorText}`);
      throw new Error(
        `IGDB API error ${response.status}: ${response.statusText}`,
      );
    }

    return (await response.json()) as IgdbApiGame[];
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
   * Returns the inserted/existing game rows as detail DTOs.
   */
  async upsertGamesFromApi(apiGames: IgdbApiGame[]): Promise<GameDetailDto[]> {
    if (apiGames.length === 0) return [];

    const rows = apiGames.map((g) => this.mapApiGameToDbRow(g));

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
      .where(sql`${schema.games.igdbId} = ANY(${igdbIds})`);

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
}
