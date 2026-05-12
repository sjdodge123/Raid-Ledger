/**
 * Controller for public user endpoints (ROK-181).
 * /users/me/* routes are in users-me.controller.ts.
 * Admin-only management endpoints are in users-management.controller.ts.
 */
import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  NotFoundException,
  BadRequestException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CharactersService } from '../characters/characters.service';
import { EventsService } from '../events/events.service';
import type {
  PlayersListResponseDto,
  RecentPlayersResponseDto,
  UserProfileDto,
  UserEventSignupsResponseDto,
  UserActivityResponseDto,
  UserHeartedGamesResponseDto,
  SteamLibraryResponseDto,
  SteamWishlistResponseDto,
} from '@raid-ledger/contract';
import { ActivityPeriodSchema } from '@raid-ledger/contract';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import {
  parsePagination,
  parsePlaytimeMin,
  parsePlayHistory,
  resolveSources,
  buildPaginatedMeta,
} from './users-controller.helpers';

type RequestWithMaybeUser = { user?: { id: number; role?: string } };

/** Controller for public user endpoints. */
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly charactersService: CharactersService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Verify target user is visible to the requester (ROK-1260).
   * Throws 404 when target is deactivated AND requester is not admin.
   */
  private async assertUserVisible(
    targetUserId: number,
    req?: RequestWithMaybeUser,
  ): Promise<NonNullable<Awaited<ReturnType<UsersService['findById']>>>> {
    const user = await this.usersService.findById(targetUserId);
    if (!user) throw new NotFoundException('User not found');
    if (user.deactivatedAt != null && req?.user?.role !== 'admin') {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /** List all registered players (paginated, with optional search and filters). */
  @Get()
  async listPlayers(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('search') search?: string,
    @Query('gameId') gameIdStr?: string,
    @Query('source') source?: string,
    @Query('sources') sourcesStr?: string,
    @Query('role') role?: string,
    @Query('playtimeMin') playtimeMinStr?: string,
    @Query('playHistory') playHistoryStr?: string,
  ): Promise<PlayersListResponseDto> {
    const { page, limit } = parsePagination(pageStr, limitStr);
    const gameId = gameIdStr ? parseInt(gameIdStr, 10) || undefined : undefined;
    const sources = resolveSources(source, sourcesStr);
    const playtimeMin = parsePlaytimeMin(playtimeMinStr);
    const playHistory = parsePlayHistory(playHistoryStr);
    const result = await this.usersService.findAll(
      page,
      limit,
      search || undefined,
      gameId,
      sources,
      playtimeMin,
      playHistory,
      role || undefined,
    );
    return {
      data: result.data,
      meta: buildPaginatedMeta(result.total, page, limit),
    };
  }

  /** List recently joined players (last 30 days, max 10) (ROK-298). */
  @Get('recent')
  async listRecentPlayers(): Promise<RecentPlayersResponseDto> {
    const rows = await this.usersService.findRecent();
    return {
      data: rows.map((u) => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        discordId: u.discordId,
        customAvatarUrl: u.customAvatarUrl,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  }

  /** Get a user's public profile by ID. */
  @Get(':id/profile')
  @UseGuards(OptionalJwtGuard)
  async getProfile(
    @Param('id', ParseIntPipe) id: number,
    @Request() req?: RequestWithMaybeUser,
  ): Promise<{ data: UserProfileDto }> {
    const user = await this.assertUserVisible(id, req);
    const charactersResult = await this.charactersService.findAllForUser(id);
    return {
      data: {
        id: user.id,
        username: user.username,
        avatar: user.avatar || null,
        discordId: user.discordId || null,
        customAvatarUrl: user.customAvatarUrl || null,
        createdAt: user.createdAt.toISOString(),
        characters: charactersResult.data,
      },
    };
  }

  /** Get a user's characters, optionally filtered by game (ROK-461). */
  @Get(':id/characters')
  @UseGuards(OptionalJwtGuard)
  async getUserCharacters(
    @Param('id', ParseIntPipe) id: number,
    @Query('gameId') gameId?: string,
    @Request() req?: RequestWithMaybeUser,
  ): Promise<{ data: import('@raid-ledger/contract').CharacterDto[] }> {
    await this.assertUserVisible(id, req);
    const parsedGameId = gameId ? parseInt(gameId, 10) : undefined;
    const result = await this.charactersService.findAllForUser(
      id,
      parsedGameId || undefined,
    );
    return { data: result.data };
  }

  /** Get games a user has hearted (ROK-282, ROK-754: paginated + steam filtered). */
  @Get(':id/hearted-games')
  @UseGuards(OptionalJwtGuard)
  async getHeartedGames(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Request() req?: RequestWithMaybeUser,
  ): Promise<UserHeartedGamesResponseDto> {
    await this.assertUserVisible(id, req);
    const { page, limit } = parsePagination(pageStr, limitStr);
    const result = await this.usersService.getHeartedGames(id, page, limit);
    return {
      data: result.data,
      meta: buildPaginatedMeta(result.total, page, limit),
    };
  }

  /** Get a user's Steam library (ROK-754). */
  @Get(':id/steam-library')
  @UseGuards(OptionalJwtGuard)
  async getSteamLibrary(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Request() req?: RequestWithMaybeUser,
  ): Promise<SteamLibraryResponseDto> {
    await this.assertUserVisible(id, req);
    const { page, limit } = parsePagination(pageStr, limitStr);
    const result = await this.usersService.getSteamLibrary(id, page, limit);
    return {
      data: result.data,
      meta: buildPaginatedMeta(result.total, page, limit),
    };
  }

  /** Get a user's Steam wishlist (ROK-418). */
  @Get(':id/steam-wishlist')
  @UseGuards(OptionalJwtGuard)
  async getSteamWishlist(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Request() req?: RequestWithMaybeUser,
  ): Promise<SteamWishlistResponseDto> {
    await this.assertUserVisible(id, req);
    const { page, limit } = parsePagination(pageStr, limitStr);
    const result = await this.usersService.getSteamWishlist(id, page, limit);
    return {
      data: result.data,
      meta: buildPaginatedMeta(result.total, page, limit),
    };
  }

  /** Get a user's game activity (ROK-443). */
  @Get(':id/activity')
  @UseGuards(OptionalJwtGuard)
  async getUserActivity(
    @Param('id', ParseIntPipe) id: number,
    @Query('period') periodParam?: string,
    @Request() req?: RequestWithMaybeUser,
  ): Promise<UserActivityResponseDto> {
    const period = ActivityPeriodSchema.safeParse(periodParam ?? 'week');
    if (!period.success)
      throw new BadRequestException(
        'Invalid period. Must be week, month, or all.',
      );
    await this.assertUserVisible(id, req);
    const data = await this.usersService.getUserActivity(
      id,
      period.data,
      req?.user?.id,
    );
    return { data, period: period.data };
  }

  /** Get upcoming events a user has signed up for (ROK-299). */
  @Get(':id/events/signups')
  @UseGuards(OptionalJwtGuard)
  async getUserEventSignups(
    @Param('id', ParseIntPipe) id: number,
    @Request() req?: RequestWithMaybeUser,
  ): Promise<UserEventSignupsResponseDto> {
    await this.assertUserVisible(id, req);
    return this.eventsService.findUpcomingByUser(id);
  }
}
