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
import { ItadPriceService } from '../itad/itad-price.service';
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
import type {
  ItadGamePricingDto,
  ItadBatchPricingResponseDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { redisSwr } from '../common/swr-cache';
import { handleSearchError } from './igdb-controller.helpers';
import { fetchGameEventTypes } from './igdb-event-types.helpers';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { UserRole } from '@raid-ledger/contract';
import { buildDiscoverCategories } from './igdb-discover.helpers';
import { dispatchDiscoverRow } from './igdb-discover-dispatch.helpers';
import {
  batchCheckInterests,
  addInterest,
  removeInterest,
  fetchGameInterestData,
} from './igdb-interest.helpers';
import { fetchTwitchStreams } from './igdb-streams.helpers';
import {
  fetchGamePricing,
  fetchBatchGamePricing,
} from './igdb-pricing.helpers';
import { parseBatchIds } from './igdb-batch.util';
import { lookupGameBySteamAppId } from './igdb-game-lookup.helpers';

interface AuthRequest extends Request {
  user: { id: number; role: UserRole };
}

/** Controller for IGDB game discovery endpoints. */
@Controller('games')
export class IgdbController {
  private readonly logger = new Logger(IgdbController.name);
  constructor(
    private readonly igdbService: IgdbService,
    private readonly itadPriceService: ItadPriceService,
  ) {}

  /** GET /games/search -- Search for games by name. */
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
      handleSearchError(error, this.logger);
    }
  }

  /** GET /games/discover -- Returns category rows for the browse page. */
  @Get('discover')
  async discoverGames(): Promise<GameDiscoverResponseDto> {
    const db = this.igdbService.database;
    const redis = this.igdbService.redisClient;
    const cacheTtl = this.igdbService.config.DISCOVER_CACHE_TTL;
    const categories = buildDiscoverCategories();

    const rows = await Promise.all(
      categories.map((cat) => dispatchDiscoverRow(cat, db, redis, cacheTtl)),
    );
    return { rows: rows.filter((r) => r.games.length > 0) };
  }

  /** GET /games/configured -- Returns enabled games with config columns. */
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
        genres: schema.games.genres,
      })
      .from(schema.games)
      .where(eq(schema.games.enabled, true))
      .orderBy(schema.games.name);
    const data = rows.map((r) => ({ ...r, genres: r.genres ?? [] }));
    return { data, meta: { total: data.length } };
  }

  /** GET /games/:id/event-types -- Returns event types for a game. */
  @Get(':id/event-types')
  async getGameEventTypes(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EventTypesResponseDto> {
    return fetchGameEventTypes(this.igdbService.database, id);
  }

  /** GET /games/interest/batch?ids=1,2,3 -- Batch interest check. */
  @Get('interest/batch')
  @UseGuards(AuthGuard('jwt'))
  async batchInterestCheck(
    @Query('ids') idsParam: string,
    @Req() req: AuthRequest,
  ): Promise<{ data: Record<string, { wantToPlay: boolean; count: number }> }> {
    const gameIds = parseBatchIds(idsParam, 500);
    if (gameIds.length === 0) return { data: {} };
    const data = await batchCheckInterests(
      this.igdbService.database,
      gameIds,
      req.user.id,
    );
    return { data };
  }

  /**
   * GET /games/pricing/batch?ids=1,2,3 -- Batch pricing (ROK-800).
   * Rate-limit review (ROK-807): 'search' tier (30 req/min) is adequate here.
   * parseBatchIds caps at 100 IDs, and each ID resolves via Redis-cached ITAD
   * lookups (SWR). Combined with the per-IP throttle, abuse potential is low.
   */
  @RateLimit('search')
  @Get('pricing/batch')
  async batchPricing(
    @Query('ids') idsParam: string,
  ): Promise<ItadBatchPricingResponseDto> {
    const gameIds = parseBatchIds(idsParam);
    if (gameIds.length === 0) return { data: {} };
    const data = await fetchBatchGamePricing(
      this.igdbService.database,
      this.itadPriceService,
      gameIds,
    );
    return { data };
  }

  /** GET /games/by-steam-id/:steamAppId -- Lookup game by Steam App ID (ROK-945). */
  @RateLimit('search')
  @Get('by-steam-id/:steamAppId')
  async getGameBySteamAppId(
    @Param('steamAppId', ParseIntPipe) steamAppId: number,
  ) {
    const db = this.igdbService.database;
    const game = await lookupGameBySteamAppId(db, steamAppId);
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  /** GET /games/:id/activity -- Community activity for a game. */
  @Get(':id/activity')
  async getGameActivity(
    @Param('id', ParseIntPipe) id: number,
    @Query('period') periodParam?: string,
  ): Promise<GameActivityResponseDto> {
    const period = ActivityPeriodSchema.safeParse(periodParam ?? 'week');
    if (!period.success)
      throw new BadRequestException(
        'Invalid period. Must be week, month, or all.',
      );
    const db = this.igdbService.database;
    const gameExists = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);
    if (gameExists.length === 0) throw new NotFoundException('Game not found');
    return this.igdbService.getGameActivity(id, period.data);
  }

  /** GET /games/:id/now-playing -- Users currently playing this game. */
  @Get(':id/now-playing')
  async getGameNowPlaying(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GameNowPlayingResponseDto> {
    return this.igdbService.getGameNowPlaying(id);
  }

  /** GET /games/:id/pricing -- ITAD price overview for a game (ROK-419). */
  @RateLimit('search')
  @Get(':id/pricing')
  async getGamePricing(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ data: ItadGamePricingDto | null }> {
    const data = await fetchGamePricing(
      this.igdbService.database,
      this.itadPriceService,
      id,
    );
    return { data };
  }

  /** GET /games/:id -- Full game detail. */
  @Get(':id')
  async getGameDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GameDetailDto> {
    const game = await this.igdbService.getGameDetailById(id);
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  /** GET /games/:id/streams -- Live Twitch streams for a game (SWR cached). */
  @Get(':id/streams')
  async getGameStreams(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GameStreamsResponseDto> {
    const redis = this.igdbService.redisClient;
    const config = this.igdbService.config;
    const result = await redisSwr<GameStreamsResponseDto>({
      redis,
      key: `games:streams:${id}`,
      ttlSec: config.STREAMS_CACHE_TTL,
      fetcher: () =>
        fetchTwitchStreams(
          this.igdbService.database,
          id,
          () => this.igdbService['resolveCredentials'](),
          () => this.igdbService['getAccessToken'](),
        ),
    });
    return result ?? { streams: [], totalLive: 0 };
  }

  /** GET /games/:id/interest -- Get interest status for a game. */
  @Get(':id/interest')
  @UseGuards(AuthGuard('jwt'))
  async getGameInterest(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ): Promise<GameInterestResponseDto> {
    const data = await fetchGameInterestData(
      this.igdbService.database,
      id,
      req.user.id,
    );
    return {
      wantToPlay: data.source !== null,
      count: data.count,
      players: data.players,
      source: data.source
        ? (data.source as 'manual' | 'steam' | 'discord')
        : undefined,
      ownerCount: data.ownerCount,
      owners: data.owners,
      wishlisters: data.wishlisters,
      wishlistedCount: data.wishlistedCount,
      wishlistedByMe: data.wishlistedByMe,
    };
  }

  /** POST /games/:id/want-to-play -- Toggle want-to-play on. */
  @Post(':id/want-to-play')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async addWantToPlay(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ): Promise<GameInterestResponseDto> {
    const db = this.igdbService.database;
    const gameExists = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);
    if (gameExists.length === 0) throw new NotFoundException('Game not found');
    return addInterest(db, id, req.user.id);
  }

  /** DELETE /games/:id/want-to-play -- Remove want-to-play. */
  @Delete(':id/want-to-play')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async removeWantToPlay(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ): Promise<GameInterestResponseDto> {
    return removeInterest(this.igdbService.database, id, req.user.id);
  }

  /** POST /games/sync-popular -- Admin-only: enqueue IGDB sync. */
  @RateLimit('admin')
  @Post('sync-popular')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async syncPopularGames() {
    try {
      const { jobId } = await this.igdbService.enqueueSync('manual');
      return { jobId, message: 'IGDB sync job enqueued' };
    } catch (error) {
      this.logger.error(`Failed to enqueue IGDB sync: ${error}`);
      throw new InternalServerErrorException('Failed to enqueue IGDB sync job');
    }
  }
}
