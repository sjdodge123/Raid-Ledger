/**
 * Controller for public and admin user endpoints (ROK-181).
 * /users/me/* routes are in users-me.controller.ts.
 */
import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { CharactersService } from '../characters/characters.service';
import { EventsService } from '../events/events.service';
import {
  PlayersListResponseDto,
  RecentPlayersResponseDto,
  UserManagementListResponseDto,
  UserProfileDto,
  UpdateUserRoleSchema,
  UserEventSignupsResponseDto,
  ActivityPeriodSchema,
  UserActivityResponseDto,
} from '@raid-ledger/contract';
import type {
  UserHeartedGamesResponseDto,
  SteamLibraryResponseDto,
  SteamWishlistResponseDto,
} from '@raid-ledger/contract';
import type { UserRole } from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { OperatorGuard } from '../auth/operator.guard';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { parsePagination } from './users-controller.helpers';

interface AuthenticatedRequest {
  user: { id: number; role: UserRole; impersonatedBy?: number | null };
}

/** Controller for public and admin user endpoints. */
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatarService: AvatarService,
    private readonly charactersService: CharactersService,
    private readonly eventsService: EventsService,
  ) {}

  /** List all registered players (paginated, with optional search). */
  @Get()
  async listPlayers(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('search') search?: string,
    @Query('gameId') gameIdStr?: string,
    @Query('source') source?: string,
  ): Promise<PlayersListResponseDto> {
    const { page, limit } = parsePagination(pageStr, limitStr);
    const gameId = gameIdStr ? parseInt(gameIdStr, 10) || undefined : undefined;
    const result = await this.usersService.findAll(
      page,
      limit,
      search || undefined,
      gameId,
      source || undefined,
    );
    return {
      data: result.data,
      meta: {
        total: result.total,
        page,
        limit,
        hasMore: page * limit < result.total,
      },
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
  async getProfile(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ data: UserProfileDto }> {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
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
  async getUserCharacters(
    @Param('id', ParseIntPipe) id: number,
    @Query('gameId') gameId?: string,
  ): Promise<{ data: import('@raid-ledger/contract').CharacterDto[] }> {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const parsedGameId = gameId ? parseInt(gameId, 10) : undefined;
    const result = await this.charactersService.findAllForUser(
      id,
      parsedGameId || undefined,
    );
    return { data: result.data };
  }

  /** Get games a user has hearted (ROK-282, ROK-754: paginated + steam filtered). */
  @Get(':id/hearted-games')
  async getHeartedGames(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ): Promise<UserHeartedGamesResponseDto> {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const { page, limit } = parsePagination(pageStr, limitStr);
    const result = await this.usersService.getHeartedGames(id, page, limit);
    return {
      data: result.data,
      meta: {
        total: result.total,
        page,
        limit,
        hasMore: page * limit < result.total,
      },
    };
  }

  /** Get a user's Steam library (ROK-754). */
  @Get(':id/steam-library')
  async getSteamLibrary(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ): Promise<SteamLibraryResponseDto> {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const { page, limit } = parsePagination(pageStr, limitStr);
    const result = await this.usersService.getSteamLibrary(id, page, limit);
    return {
      data: result.data,
      meta: {
        total: result.total,
        page,
        limit,
        hasMore: page * limit < result.total,
      },
    };
  }

  /** Get a user's Steam wishlist (ROK-418). */
  @Get(':id/steam-wishlist')
  async getSteamWishlist(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ): Promise<SteamWishlistResponseDto> {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const { page, limit } = parsePagination(pageStr, limitStr);
    const result = await this.usersService.getSteamWishlist(id, page, limit);
    return {
      data: result.data,
      meta: {
        total: result.total,
        page,
        limit,
        hasMore: page * limit < result.total,
      },
    };
  }

  /** Get a user's game activity (ROK-443). */
  @Get(':id/activity')
  @UseGuards(OptionalJwtGuard)
  async getUserActivity(
    @Param('id', ParseIntPipe) id: number,
    @Query('period') periodParam?: string,
    @Request() req?: { user?: { id: number } },
  ): Promise<UserActivityResponseDto> {
    const period = ActivityPeriodSchema.safeParse(periodParam ?? 'week');
    if (!period.success)
      throw new BadRequestException(
        'Invalid period. Must be week, month, or all.',
      );
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const data = await this.usersService.getUserActivity(
      id,
      period.data,
      req?.user?.id,
    );
    return { data, period: period.data };
  }

  /** Get upcoming events a user has signed up for (ROK-299). */
  @Get(':id/events/signups')
  async getUserEventSignups(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserEventSignupsResponseDto> {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return this.eventsService.findUpcomingByUser(id);
  }

  /** List all users with role information (admin-only, ROK-272). */
  @Get('management')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async listUsersForManagement(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('search') search?: string,
  ): Promise<UserManagementListResponseDto> {
    const { page, limit } = parsePagination(pageStr, limitStr);
    const result = await this.usersService.findAllWithRoles(
      page,
      limit,
      search || undefined,
    );
    return {
      data: result.data.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
      meta: {
        total: result.total,
        page,
        limit,
        hasMore: page * limit < result.total,
      },
    };
  }

  /** Update a user's role (admin-only, ROK-272). */
  @Patch(':id/role')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = UpdateUserRoleSchema.parse(body);
    if (id === req.user.id)
      throw new ForbiddenException('Cannot change your own role');
    const targetUser = await this.usersService.findById(id);
    if (!targetUser) throw new NotFoundException('User not found');
    if (targetUser.role === 'admin')
      throw new ForbiddenException('Cannot modify admin role via API');
    const updated = await this.usersService.setRole(id, dto.role);
    return {
      data: { id: updated.id, username: updated.username, role: updated.role },
    };
  }

  /** Admin-remove a user (ROK-405). */
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @HttpCode(204)
  async adminRemoveUser(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ) {
    if (id === req.user.id)
      throw new BadRequestException('Cannot delete yourself');
    const targetUser = await this.usersService.findById(id);
    if (!targetUser) throw new NotFoundException('User not found');
    if (targetUser.role === 'admin')
      throw new ForbiddenException('Cannot delete another admin');
    if (targetUser.customAvatarUrl)
      await this.avatarService.delete(targetUser.customAvatarUrl);
    await this.usersService.deleteUser(id, req.user.id);
  }

  /** Operator+: remove any user's custom avatar (ROK-220 content moderation). */
  @Delete(':id/avatar')
  @UseGuards(AuthGuard('jwt'), OperatorGuard)
  @HttpCode(204)
  async adminDeleteAvatar(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (user.customAvatarUrl) {
      await this.avatarService.delete(user.customAvatarUrl);
      await this.usersService.setCustomAvatar(id, null);
    }
  }
}
