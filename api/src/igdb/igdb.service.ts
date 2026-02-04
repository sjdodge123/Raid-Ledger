import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, ilike } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
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

/** Constants for IGDB integration */
const IGDB_CONFIG = {
  /** Buffer time before token expiry (seconds) */
  TOKEN_EXPIRY_BUFFER: 300,
  /** Maximum games to return per search */
  SEARCH_LIMIT: 20,
  /** IGDB cover image base URL */
  COVER_URL_BASE: 'https://images.igdb.com/igdb/image/upload/t_cover_big',
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
   * Search games by name - checks local cache first, then falls back to IGDB API.
   * Results are cached permanently per NFR-007.
   * @param query - Search query string
   * @returns Object containing games array and cache hit status
   */
  async searchGames(
    query: string,
  ): Promise<{ games: IgdbGameDto[]; cached: boolean }> {
    // Escape special LIKE characters to prevent injection
    const escapedQuery = this.escapeLikePattern(query);

    // Check local cache first (case-insensitive search)
    const cachedGames = await this.db
      .select()
      .from(schema.games)
      .where(ilike(schema.games.name, `%${escapedQuery}%`))
      .limit(IGDB_CONFIG.SEARCH_LIMIT);

    if (cachedGames.length > 0) {
      this.logger.debug(`Cache hit for query: ${query}`);
      return {
        games: cachedGames.map((g) => ({
          id: g.id,
          igdbId: g.igdbId,
          name: g.name,
          slug: g.slug,
          coverUrl: g.coverUrl,
        })),
        cached: true,
      };
    }

    // Cache miss - fetch from IGDB
    this.logger.debug(`Cache miss for query: ${query}, fetching from IGDB`);
    const igdbGames = await this.fetchFromIgdb(query);

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

    return {
      games: freshGames.map((g) => ({
        id: g.id,
        igdbId: g.igdbId,
        name: g.name,
        slug: g.slug,
        coverUrl: g.coverUrl,
      })),
      cached: false,
    };
  }

  /**
   * Fetch games from IGDB API.
   * @param query - Search query string
   * @returns Array of games from IGDB
   * @throws Error if API call fails
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
      throw new Error(`IGDB API error: ${response.statusText}`);
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
