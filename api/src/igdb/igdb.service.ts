import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, ilike } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { IgdbGameDto } from '@raid-ledger/contract';

/** IGDB API game response structure */
interface IgdbApiGame {
  id: number;
  name: string;
  slug: string;
  cover?: {
    image_id: string;
  };
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
  /** Redis cache TTL for search results (24 hours) */
  SEARCH_CACHE_TTL: 86400,
  /** Maximum retry attempts for 429 errors */
  MAX_RETRIES: 3,
  /** Base delay for exponential backoff (ms) */
  BASE_RETRY_DELAY: 1000,
} as const;

@Injectable()
export class IgdbService {
  private readonly logger = new Logger(IgdbService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenFetchPromise: Promise<string> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT)
    private redis: Redis,
  ) {}

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
    const clientId = this.configService.get<string>('IGDB_CLIENT_ID');
    const clientSecret = this.configService.get<string>('IGDB_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('IGDB credentials not configured');
    }

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

      // Batch insert for performance (instead of sequential inserts)
      if (igdbGames.length > 0) {
        const gamesToInsert = igdbGames.map((game) => ({
          igdbId: game.id,
          name: game.name,
          slug: game.slug,
          coverUrl: game.cover
            ? `${IGDB_CONFIG.COVER_URL_BASE}/${game.cover.image_id}.jpg`
            : null,
        }));

        await this.db
          .insert(schema.games)
          .values(gamesToInsert)
          .onConflictDoNothing();
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
    const clientId = this.configService.get<string>('IGDB_CLIENT_ID');

    // Escape quotes in query to prevent APICALYPSE injection
    const sanitizedQuery = query.replace(/"/g, '\\"');

    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId!,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: `search "${sanitizedQuery}"; fields name, slug, cover.image_id; limit ${IGDB_CONFIG.SEARCH_LIMIT};`,
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
}
