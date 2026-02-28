import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  Logger,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { IgdbService } from './igdb.service';
import {
  GameSearchQuerySchema,
  GameSearchResponseDto,
  GameDetailDto,
  GameDiscoverResponseDto,
  GameStreamsResponseDto,
  GameInterestResponseDto,
  GameRegistryListResponseDto,
  EventTypesResponseDto,
  ActivityPeriodSchema,
  GameActivityResponseDto,
  GameNowPlayingResponseDto,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { eq, sql, and, inArray, isNull, desc, gte } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

import type { UserRole } from '@raid-ledger/contract';

interface AuthRequest extends Request {
  user: { id: number; role: UserRole };
}

/**
 * Controller for IGDB game discovery endpoints.
 * ROK-229: Expanded with discovery, detail, streams, want-to-play.
 */
@Controller('games')
export class IgdbController {
  private readonly logger = new Logger(IgdbController.name);

  constructor(private readonly igdbService: IgdbService) {}

  /**
   * GET /games/search
   * Search for games by name.
   */
  @RateLimit('search')
  @Get('search')
  async searchGames(@Query('q') query: string): Promise<GameSearchResponseDto> {
    try {
      const validated = GameSearchQuerySchema.parse({ q: query });
      const result = await this.igdbService.searchGames(validated.q);

      return {
        data: result.games,
        meta: {
          total: result.games.length,
          cached: result.cached,
          source: result.source,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        const zodError = error as ZodError;
        const messages = zodError.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`,
        );
        throw new BadRequestException({
          message: 'Validation failed',
          errors: messages,
        });
      }

      if (error instanceof Error && error.message.includes('IGDB')) {
        this.logger.error(`IGDB API error: ${error.message}`);
        throw new InternalServerErrorException(
          'Game search service temporarily unavailable',
        );
      }

      throw error;
    }
  }

  /**
   * GET /games/discover
   * Returns category rows for the browse page.
   */
  @Get('discover')
  async discoverGames(): Promise<GameDiscoverResponseDto> {
    const db = this.igdbService.database;
    const redis = this.igdbService.redisClient;
    const config = this.igdbService.config;

    const categories = [
      {
        category: 'Your Community Wants to Play',
        slug: 'community-wants-to-play',
        cached: false, // Always live
      },
      {
        category: 'Popular MMOs',
        slug: 'popular-mmos',
        filter: sql`${schema.games.gameModes}::jsonb @> '5'::jsonb`,
        orderBy: sql`${schema.games.popularity} DESC NULLS LAST`,
      },
      {
        category: 'Top Co-op Games',
        slug: 'top-coop',
        filter: sql`${schema.games.gameModes}::jsonb @> '3'::jsonb`,
        orderBy: sql`${schema.games.rating} DESC NULLS LAST`,
      },
      {
        category: 'Trending Multiplayer',
        slug: 'trending-multiplayer',
        filter: sql`${schema.games.gameModes}::jsonb @> '2'::jsonb`,
        orderBy: sql`${schema.games.popularity} DESC NULLS LAST`,
      },
      {
        category: 'Recently Released',
        slug: 'recently-released',
        filter: sql`${schema.games.firstReleaseDate} IS NOT NULL`,
        orderBy: sql`${schema.games.firstReleaseDate} DESC NULLS LAST`,
      },
      {
        category: 'Highest Rated',
        slug: 'highest-rated',
        orderBy: sql`${schema.games.aggregatedRating} DESC NULLS LAST`,
      },
    ];

    const rows = await Promise.all(
      categories.map(async (cat) => {
        // Community row — live from game_interests
        if (cat.slug === 'community-wants-to-play') {
          const interestGames = await db
            .select({
              gameId: schema.gameInterests.gameId,
              count: sql<number>`count(*)::int`.as('count'),
            })
            .from(schema.gameInterests)
            .groupBy(schema.gameInterests.gameId)
            .orderBy(sql`count(*) desc`)
            .limit(20);

          if (interestGames.length === 0) {
            return { category: cat.category, slug: cat.slug, games: [] };
          }

          const gameIds = interestGames.map((ig) => ig.gameId);
          const games = await db
            .select()
            .from(schema.games)
            .where(
              and(
                inArray(schema.games.id, gameIds),
                eq(schema.games.hidden, false),
                eq(schema.games.banned, false),
              ),
            );

          // Maintain interest-count order
          const gameMap = new Map(games.map((g) => [g.id, g]));
          const orderedGames = gameIds
            .map((id) => gameMap.get(id))
            .filter(Boolean)
            .map((g) => this.igdbService.mapDbRowToDetail(g!));

          return {
            category: cat.category,
            slug: cat.slug,
            games: orderedGames,
          };
        }

        // Standard category — Redis-cached DB query
        const cacheKey = `games:discover:${cat.slug}`;

        try {
          const cached = await redis.get(cacheKey);
          if (cached) {
            return {
              category: cat.category,
              slug: cat.slug,
              games: JSON.parse(cached) as GameDetailDto[],
            };
          }
        } catch {
          // Redis miss — continue
        }

        const visibilityFilter = and(
          eq(schema.games.hidden, false),
          eq(schema.games.banned, false),
        );

        // Apply filter if present, always exclude hidden/banned games
        let results;
        if (cat.filter && cat.orderBy) {
          results = await db
            .select()
            .from(schema.games)
            .where(and(cat.filter, visibilityFilter))
            .orderBy(cat.orderBy)
            .limit(20);
        } else if (cat.orderBy) {
          results = await db
            .select()
            .from(schema.games)
            .where(visibilityFilter)
            .orderBy(cat.orderBy)
            .limit(20);
        } else {
          results = await db
            .select()
            .from(schema.games)
            .where(visibilityFilter)
            .limit(20);
        }

        const games = results.map((g) => this.igdbService.mapDbRowToDetail(g));

        // Cache for 1 hour
        try {
          await redis.setex(
            cacheKey,
            config.DISCOVER_CACHE_TTL,
            JSON.stringify(games),
          );
        } catch {
          // Non-fatal
        }

        return { category: cat.category, slug: cat.slug, games };
      }),
    );

    // Filter out empty rows
    return { rows: rows.filter((r) => r.games.length > 0) };
  }

  /**
   * GET /games/configured
   * Returns enabled games with their config columns (replaces GET /game-registry).
   * ROK-400: Reads from the unified games table instead of the removed game_registry table.
   */
  @Get('configured')
  async getConfiguredGames(): Promise<GameRegistryListResponseDto> {
    const db = this.igdbService.database;
    const rows = await db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        name: schema.games.name,
        shortName: schema.games.shortName,
        coverUrl: schema.games.coverUrl,
        colorHex: schema.games.colorHex,
        hasRoles: schema.games.hasRoles,
        hasSpecs: schema.games.hasSpecs,
        enabled: schema.games.enabled,
        maxCharactersPerUser: schema.games.maxCharactersPerUser,
      })
      .from(schema.games)
      .where(eq(schema.games.enabled, true))
      .orderBy(schema.games.name);

    return {
      data: rows,
      meta: { total: rows.length },
    };
  }

  /**
   * GET /games/:id/event-types
   * Returns event types for a specific game (replaces GET /game-registry/:id/event-types).
   * ROK-400: Reads from event_types table using integer games.id FK.
   */
  @Get(':id/event-types')
  async getGameEventTypes(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EventTypesResponseDto> {
    const db = this.igdbService.database;

    const gameRows = await db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (gameRows.length === 0) {
      throw new NotFoundException('Game not found');
    }

    const game = gameRows[0];
    const types = await db
      .select()
      .from(schema.eventTypes)
      .where(eq(schema.eventTypes.gameId, id))
      .orderBy(schema.eventTypes.name);

    return {
      data: types.map((t) => ({
        ...t,
        defaultPlayerCap: t.defaultPlayerCap ?? null,
        defaultDurationMinutes: t.defaultDurationMinutes ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
      meta: {
        total: types.length,
        gameId: game.id,
        gameName: game.name,
      },
    };
  }

  /**
   * GET /games/interest/batch?ids=1,2,3
   * Batch check want-to-play status for multiple games at once.
   * Returns a map of gameId -> { wantToPlay, count }.
   */
  @Get('interest/batch')
  @UseGuards(AuthGuard('jwt'))
  async batchInterestCheck(
    @Query('ids') idsParam: string,
    @Req() req: AuthRequest,
  ): Promise<{ data: Record<string, { wantToPlay: boolean; count: number }> }> {
    if (!idsParam) {
      return { data: {} };
    }

    const gameIds = idsParam
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .slice(0, 100); // Cap at 100 IDs

    if (gameIds.length === 0) {
      return { data: {} };
    }

    const db = this.igdbService.database;
    const userId = req.user.id;

    // Get counts for all requested games in one query
    const counts = await db
      .select({
        gameId: schema.gameInterests.gameId,
        count: sql<number>`count(*)::int`.as('count'),
      })
      .from(schema.gameInterests)
      .where(inArray(schema.gameInterests.gameId, gameIds))
      .groupBy(schema.gameInterests.gameId);

    // Get user's interests for all requested games in one query
    const userInterests = await db
      .select({ gameId: schema.gameInterests.gameId })
      .from(schema.gameInterests)
      .where(
        and(
          inArray(schema.gameInterests.gameId, gameIds),
          eq(schema.gameInterests.userId, userId),
        ),
      );

    const countMap = new Map(counts.map((c) => [c.gameId, c.count]));
    const userSet = new Set(userInterests.map((i) => i.gameId));

    const data: Record<string, { wantToPlay: boolean; count: number }> = {};
    for (const id of gameIds) {
      data[String(id)] = {
        wantToPlay: userSet.has(id),
        count: countMap.get(id) ?? 0,
      };
    }

    return { data };
  }

  /**
   * GET /games/:id/activity
   * ROK-443: Community activity for a game — top players and total hours.
   * Public endpoint. Respects show_activity privacy preference.
   */
  @Get(':id/activity')
  async getGameActivity(
    @Param('id', ParseIntPipe) id: number,
    @Query('period') periodParam?: string,
  ): Promise<GameActivityResponseDto> {
    const period = ActivityPeriodSchema.safeParse(periodParam ?? 'week');
    if (!period.success) {
      throw new BadRequestException(
        'Invalid period. Must be week, month, or all.',
      );
    }

    const db = this.igdbService.database;

    // Verify game exists
    const gameExists = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);
    if (gameExists.length === 0) {
      throw new NotFoundException('Game not found');
    }

    // Build the base conditions for rollup query
    const baseConditions = [eq(schema.gameActivityRollups.gameId, id)];
    if (period.data !== 'all') {
      const periodFilter = period.data === 'week' ? 'week' : 'month';
      const truncFn = period.data === 'week' ? 'week' : 'month';
      baseConditions.push(eq(schema.gameActivityRollups.period, periodFilter));
      baseConditions.push(
        gte(
          schema.gameActivityRollups.periodStart,
          sql`date_trunc(${truncFn}, now())::date`,
        ),
      );
    }

    // Query top players with privacy filtering
    // LEFT JOIN user_preferences to exclude users with show_activity=false
    const topPlayers = await db
      .select({
        userId: schema.gameActivityRollups.userId,
        username: schema.users.username,
        avatar: schema.users.avatar,
        customAvatarUrl: schema.users.customAvatarUrl,
        discordId: schema.users.discordId,
        totalSeconds: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})::int`,
      })
      .from(schema.gameActivityRollups)
      .innerJoin(
        schema.users,
        eq(schema.gameActivityRollups.userId, schema.users.id),
      )
      .leftJoin(
        schema.userPreferences,
        and(
          eq(schema.userPreferences.userId, schema.gameActivityRollups.userId),
          eq(schema.userPreferences.key, sql`'show_activity'`),
        ),
      )
      .where(
        and(
          ...baseConditions,
          // Include users who don't have the preference set (default true)
          // or whose preference is not explicitly false
          sql`(${schema.userPreferences.value} IS NULL OR ${schema.userPreferences.value}::text != 'false')`,
        ),
      )
      .groupBy(
        schema.gameActivityRollups.userId,
        schema.users.username,
        schema.users.avatar,
        schema.users.customAvatarUrl,
        schema.users.discordId,
      )
      .orderBy(desc(sql`sum(${schema.gameActivityRollups.totalSeconds})`))
      .limit(10);

    // Calculate total community seconds (same privacy filter)
    const [totalResult] = await db
      .select({
        totalSeconds: sql<number>`coalesce(sum(${schema.gameActivityRollups.totalSeconds})::int, 0)`,
      })
      .from(schema.gameActivityRollups)
      .leftJoin(
        schema.userPreferences,
        and(
          eq(schema.userPreferences.userId, schema.gameActivityRollups.userId),
          eq(schema.userPreferences.key, sql`'show_activity'`),
        ),
      )
      .where(
        and(
          ...baseConditions,
          sql`(${schema.userPreferences.value} IS NULL OR ${schema.userPreferences.value}::text != 'false')`,
        ),
      );

    return {
      topPlayers: topPlayers.map((p) => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatar,
        customAvatarUrl: p.customAvatarUrl,
        discordId: p.discordId,
        totalSeconds: p.totalSeconds,
      })),
      totalSeconds: totalResult?.totalSeconds ?? 0,
      period: period.data,
    };
  }

  /**
   * GET /games/:id/now-playing
   * ROK-443: Users currently playing this game (open sessions).
   * Public endpoint. Respects show_activity privacy preference.
   */
  @Get(':id/now-playing')
  async getGameNowPlaying(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GameNowPlayingResponseDto> {
    const db = this.igdbService.database;

    const players = await db
      .select({
        userId: schema.gameActivitySessions.userId,
        username: schema.users.username,
        avatar: schema.users.avatar,
        customAvatarUrl: schema.users.customAvatarUrl,
        discordId: schema.users.discordId,
      })
      .from(schema.gameActivitySessions)
      .innerJoin(
        schema.users,
        eq(schema.gameActivitySessions.userId, schema.users.id),
      )
      .leftJoin(
        schema.userPreferences,
        and(
          eq(schema.userPreferences.userId, schema.gameActivitySessions.userId),
          eq(schema.userPreferences.key, sql`'show_activity'`),
        ),
      )
      .where(
        and(
          eq(schema.gameActivitySessions.gameId, id),
          isNull(schema.gameActivitySessions.endedAt),
          sql`(${schema.userPreferences.value} IS NULL OR ${schema.userPreferences.value}::text != 'false')`,
        ),
      );

    return {
      players: players.map((p) => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatar,
        customAvatarUrl: p.customAvatarUrl,
        discordId: p.discordId,
      })),
      count: players.length,
    };
  }

  /**
   * GET /games/:id
   * Full game detail.
   */
  @Get(':id')
  async getGameDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GameDetailDto> {
    const game = await this.igdbService.getGameDetailById(id);
    if (!game) {
      throw new NotFoundException('Game not found');
    }
    return game;
  }

  /**
   * GET /games/:id/streams
   * Live Twitch streams for a game.
   */
  @Get(':id/streams')
  async getGameStreams(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GameStreamsResponseDto> {
    const redis = this.igdbService.redisClient;
    const config = this.igdbService.config;

    // Check cache first
    const cacheKey = `games:streams:${id}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as GameStreamsResponseDto;
      }
    } catch {
      // Continue
    }

    // Get the game to find Twitch game ID
    const db = this.igdbService.database;
    const gameRows = await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (gameRows.length === 0) {
      throw new NotFoundException('Game not found');
    }

    const game = gameRows[0];
    const twitchGameId = game.twitchGameId;

    if (!twitchGameId) {
      const result: GameStreamsResponseDto = { streams: [], totalLive: 0 };
      return result;
    }

    try {
      // Get a Twitch access token (same as IGDB — shared Twitch app)
      const { clientId } = await this.igdbService['resolveCredentials']();
      const token = await this.igdbService['getAccessToken']();

      const response = await fetch(
        `https://api.twitch.tv/helix/streams?game_id=${encodeURIComponent(twitchGameId)}&first=10`,
        {
          headers: {
            'Client-ID': clientId,
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        this.logger.warn(`Twitch streams API error: ${response.status}`);
        return { streams: [], totalLive: 0 };
      }

      const data = (await response.json()) as {
        data: {
          user_name: string;
          title: string;
          viewer_count: number;
          thumbnail_url: string;
          language: string;
        }[];
        pagination: { cursor?: string };
      };

      const result: GameStreamsResponseDto = {
        streams: data.data.map((s) => ({
          userName: s.user_name,
          title: s.title,
          viewerCount: s.viewer_count,
          thumbnailUrl: s.thumbnail_url
            .replace('{width}', '440')
            .replace('{height}', '248'),
          language: s.language,
        })),
        totalLive: data.data.length,
      };

      // Cache for 5 minutes
      try {
        await redis.setex(
          cacheKey,
          config.STREAMS_CACHE_TTL,
          JSON.stringify(result),
        );
      } catch {
        // Non-fatal
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to fetch Twitch streams: ${error}`);
      return { streams: [], totalLive: 0 };
    }
  }

  /**
   * GET /games/:id/interest
   * Get interest status for a game.
   */
  @Get(':id/interest')
  @UseGuards(AuthGuard('jwt'))
  async getGameInterest(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ): Promise<GameInterestResponseDto> {
    const db = this.igdbService.database;
    const userId = req.user.id;

    const [countResult, userInterest, playerPreviews] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.gameInterests)
        .where(eq(schema.gameInterests.gameId, id)),
      db
        .select()
        .from(schema.gameInterests)
        .where(
          and(
            eq(schema.gameInterests.gameId, id),
            eq(schema.gameInterests.userId, userId),
          ),
        )
        .limit(1),
      this.getInterestedPlayers(id),
    ]);

    return {
      wantToPlay: userInterest.length > 0,
      count: countResult[0]?.count ?? 0,
      players: playerPreviews,
    };
  }

  /**
   * POST /games/:id/want-to-play
   * Toggle want-to-play on (idempotent).
   */
  @Post(':id/want-to-play')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async addWantToPlay(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ): Promise<GameInterestResponseDto> {
    const db = this.igdbService.database;
    const userId = req.user.id;

    // Verify game exists
    const gameExists = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (gameExists.length === 0) {
      throw new NotFoundException('Game not found');
    }

    // Upsert interest (idempotent)
    await db
      .insert(schema.gameInterests)
      .values({
        userId,
        gameId: id,
        source: 'manual',
      })
      .onConflictDoNothing();

    // Return updated count + player previews (ROK-282)
    const [countResult, playerPreviews] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.gameInterests)
        .where(eq(schema.gameInterests.gameId, id)),
      this.getInterestedPlayers(id),
    ]);

    return {
      wantToPlay: true,
      count: countResult[0]?.count ?? 0,
      players: playerPreviews,
    };
  }

  /**
   * DELETE /games/:id/want-to-play
   * Remove want-to-play.
   */
  @Delete(':id/want-to-play')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async removeWantToPlay(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ): Promise<GameInterestResponseDto> {
    const db = this.igdbService.database;
    const userId = req.user.id;

    await db
      .delete(schema.gameInterests)
      .where(
        and(
          eq(schema.gameInterests.gameId, id),
          eq(schema.gameInterests.userId, userId),
        ),
      );

    // Return updated count + player previews (ROK-282)
    const [countResult, playerPreviews] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.gameInterests)
        .where(eq(schema.gameInterests.gameId, id)),
      this.getInterestedPlayers(id),
    ]);

    return {
      wantToPlay: false,
      count: countResult[0]?.count ?? 0,
      players: playerPreviews,
    };
  }

  /**
   * ROK-282: Fetch first 8 interested players for avatar display.
   */
  private async getInterestedPlayers(gameId: number) {
    const db = this.igdbService.database;
    const rows = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        avatar: schema.users.avatar,
        customAvatarUrl: schema.users.customAvatarUrl,
        discordId: schema.users.discordId,
      })
      .from(schema.gameInterests)
      .innerJoin(schema.users, eq(schema.gameInterests.userId, schema.users.id))
      .where(eq(schema.gameInterests.gameId, gameId))
      .orderBy(schema.gameInterests.createdAt)
      .limit(8);

    return rows.map((p) => ({
      id: p.id,
      username: p.username,
      avatar: p.avatar,
      customAvatarUrl: p.customAvatarUrl,
      discordId: p.discordId,
    }));
  }

  /**
   * POST /games/sync-popular
   * Admin-only: pull top 100 popular multiplayer games from IGDB.
   */
  @RateLimit('admin')
  @Post('sync-popular')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async syncPopularGames(): Promise<{
    jobId: string;
    message: string;
  }> {
    try {
      const { jobId } = await this.igdbService.enqueueSync('manual');

      this.logger.log(`IGDB sync job enqueued: ${jobId}`);

      return {
        jobId,
        message: 'IGDB sync job enqueued',
      };
    } catch (error) {
      this.logger.error(`Failed to enqueue IGDB sync: ${error}`);
      throw new InternalServerErrorException('Failed to enqueue IGDB sync job');
    }
  }
}
