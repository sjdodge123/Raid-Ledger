import {
  Controller,
  Get,
  Put,
  Post,
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
  UseInterceptors,
  UploadedFile,
  Request,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodError } from 'zod';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { PreferencesService } from './preferences.service';
import { GameTimeService } from './game-time.service';
import { CharactersService } from '../characters/characters.service';
import { EventsService } from '../events/events.service';
import {
  UserProfileDto,
  PlayersListResponseDto,
  RecentPlayersResponseDto,
  UserManagementListResponseDto,
  UpdatePreferenceSchema,
  UpdateUserRoleSchema,
  GameTimeTemplateInputSchema,
  GameTimeOverrideInputSchema,
  GameTimeAbsenceInputSchema,
  UserHeartedGamesResponseDto,
  UserEventSignupsResponseDto,
  UpdateUserProfileSchema,
  CheckDisplayNameQuerySchema,
  DeleteAccountSchema,
  ActivityPeriodSchema,
  UserActivityResponseDto,
} from '@raid-ledger/contract';
import type {
  UserRole,
  DiscordMembershipResponseDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { OperatorGuard } from '../auth/operator.guard';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';

interface AuthenticatedRequest {
  user: {
    id: number;
    role: UserRole;
    impersonatedBy?: number | null;
  };
}

/**
 * Controller for user endpoints (ROK-181, ROK-195).
 * Public profile endpoint + authenticated preference management.
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatarService: AvatarService,
    private readonly preferencesService: PreferencesService,
    private readonly gameTimeService: GameTimeService,
    private readonly charactersService: CharactersService,
    private readonly eventsService: EventsService,
    private readonly discordBotClientService: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
  ) {}

  /**
   * List all registered players (paginated, with optional search).
   * Public endpoint for the Players page.
   * ROK-282: Optional gameId filter to show only players who hearted a specific game.
   */
  @Get()
  async listPlayers(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('search') search?: string,
    @Query('gameId') gameIdStr?: string,
  ): Promise<PlayersListResponseDto> {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitStr ?? '20', 10) || 20),
    );
    const gameId = gameIdStr ? parseInt(gameIdStr, 10) || undefined : undefined;

    const result = await this.usersService.findAll(
      page,
      limit,
      search || undefined,
      gameId,
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

  /**
   * List recently joined players (last 30 days, max 10).
   * Public endpoint for the "New Members" section on the Players page (ROK-298).
   */
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

  /**
   * Get a user's public profile by ID.
   * Returns username, avatar, member since, and public characters.
   */
  @Get(':id/profile')
  async getProfile(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ data: UserProfileDto }> {
    const user = await this.usersService.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get user's characters (public data)
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

  /**
   * ROK-461: Get a user's characters, optionally filtered by game.
   * Used by admin roster assignment to select a character on behalf of a player.
   */
  @Get(':id/characters')
  async getUserCharacters(
    @Param('id', ParseIntPipe) id: number,
    @Query('gameId') gameId?: string,
  ): Promise<{ data: import('@raid-ledger/contract').CharacterDto[] }> {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const parsedGameId = gameId ? parseInt(gameId, 10) : undefined;
    const result = await this.charactersService.findAllForUser(
      id,
      parsedGameId || undefined,
    );
    return { data: result.data };
  }

  /**
   * ROK-282: Get games a user has hearted.
   * Public endpoint for displaying hearted games on a user's profile.
   */
  @Get(':id/hearted-games')
  async getHeartedGames(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserHeartedGamesResponseDto> {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const games = await this.usersService.getHeartedGames(id);
    return { data: games };
  }

  /**
   * ROK-443: Get a user's game activity (recently played games).
   * Public endpoint with optional JWT to check requester identity for privacy.
   */
  @Get(':id/activity')
  @UseGuards(OptionalJwtGuard)
  async getUserActivity(
    @Param('id', ParseIntPipe) id: number,
    @Query('period') periodParam?: string,
    @Request() req?: { user?: { id: number } },
  ): Promise<UserActivityResponseDto> {
    const period = ActivityPeriodSchema.safeParse(periodParam ?? 'week');
    if (!period.success) {
      throw new BadRequestException(
        'Invalid period. Must be week, month, or all.',
      );
    }

    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const requesterId = req?.user?.id;
    const data = await this.usersService.getUserActivity(
      id,
      period.data,
      requesterId,
    );

    return { data, period: period.data };
  }

  /**
   * ROK-299: Get upcoming events a user has signed up for.
   * Public endpoint for displaying on a user's profile.
   */
  @Get(':id/events/signups')
  async getUserEventSignups(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserEventSignupsResponseDto> {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.eventsService.findUpcomingByUser(id);
  }

  /**
   * ROK-219: Check if a display name is available.
   * Authenticated to allow excluding current user from uniqueness check.
   */
  @Get('check-display-name')
  @UseGuards(AuthGuard('jwt'))
  async checkDisplayName(
    @Request() req: AuthenticatedRequest,
    @Query('name') name?: string,
  ) {
    if (!name) {
      throw new BadRequestException('name query parameter is required');
    }

    try {
      const parsed = CheckDisplayNameQuerySchema.parse({ name });
      const available = await this.usersService.checkDisplayNameAvailability(
        parsed.name,
        req.user.id,
      );
      return { available };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
      }
      throw error;
    }
  }

  /**
   * ROK-219: Update current user's profile (display name).
   */
  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  async updateMyProfile(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    try {
      const dto = UpdateUserProfileSchema.parse(body);

      // Check display name availability
      const available = await this.usersService.checkDisplayNameAvailability(
        dto.displayName,
        req.user.id,
      );
      if (!available) {
        throw new BadRequestException('Display name is already taken');
      }

      const updated = await this.usersService.setDisplayName(
        req.user.id,
        dto.displayName,
      );
      return {
        data: {
          id: updated.id,
          username: updated.username,
          displayName: updated.displayName,
        },
      };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
      }
      throw error;
    }
  }

  /**
   * ROK-219: Mark FTE onboarding as completed.
   */
  @Post('me/complete-onboarding')
  @UseGuards(AuthGuard('jwt'))
  async completeOnboarding(@Request() req: AuthenticatedRequest) {
    const updated = await this.usersService.completeOnboarding(req.user.id);
    return {
      success: true,
      onboardingCompletedAt: updated.onboardingCompletedAt!.toISOString(),
    };
  }

  /**
   * ROK-219: Reset onboarding to allow wizard re-run from settings.
   */
  @Post('me/reset-onboarding')
  @UseGuards(AuthGuard('jwt'))
  async resetOnboarding(@Request() req: AuthenticatedRequest) {
    await this.usersService.resetOnboarding(req.user.id);
    return { success: true };
  }

  /**
   * ROK-425: Check if current user is a member of the bot's Discord guild.
   * Used by the Discord join banner on the frontend.
   */
  @Get('me/discord-membership')
  @UseGuards(AuthGuard('jwt'))
  async getDiscordMembership(
    @Request() req: AuthenticatedRequest,
  ): Promise<DiscordMembershipResponseDto> {
    if (!this.discordBotClientService.isConnected()) {
      return { botConnected: false };
    }

    const guildInfo = this.discordBotClientService.getGuildInfo();
    if (!guildInfo) {
      return { botConnected: false };
    }

    // Get the user's discord ID
    const user = await this.usersService.findById(req.user.id);
    if (
      !user?.discordId ||
      user.discordId.startsWith('local:') ||
      user.discordId.startsWith('unlinked:')
    ) {
      return { botConnected: true, guildName: guildInfo.name, isMember: false };
    }

    // Check if user is in the guild
    const client = this.discordBotClientService.getClient();
    const guild = client?.guilds.cache.first();
    if (!guild) {
      return { botConnected: false };
    }

    try {
      await guild.members.fetch(user.discordId);
      // Member found — they're in the server
      return { botConnected: true, guildName: guildInfo.name, isMember: true };
    } catch {
      // Member not found (404) — generate invite
      const inviteUrl = await this.generateJoinInvite(guild);
      return {
        botConnected: true,
        guildName: guildInfo.name,
        isMember: false,
        inviteUrl: inviteUrl ?? undefined,
      };
    }
  }

  /**
   * Generate a Discord server invite for the join banner.
   * Creates a multi-use invite with 24h expiry.
   */
  private async generateJoinInvite(
    guild: import('discord.js').Guild,
  ): Promise<string | null> {
    try {
      let channelId = await this.channelResolver.resolveChannelForEvent();

      if (!channelId && guild.systemChannelId) {
        channelId = guild.systemChannelId;
      }

      if (!channelId) {
        const firstText = guild.channels.cache.find(
          (ch) => ch.isTextBased() && !ch.isThread() && !ch.isDMBased(),
        );
        if (firstText) channelId = firstText.id;
      }

      if (!channelId) return null;

      const channel = await guild.channels.fetch(channelId);
      if (!channel || !('createInvite' in channel)) return null;

      const invite = await channel.createInvite({
        maxAge: 86400, // 24 hours
        maxUses: 0, // unlimited uses
        unique: false, // reuse existing if available
        reason: 'Discord join banner invite (ROK-425)',
      });

      return invite.url;
    } catch {
      return null;
    }
  }

  /**
   * Get current user's preferences (ROK-195).
   * Requires JWT authentication.
   */
  @Get('me/preferences')
  @UseGuards(AuthGuard('jwt'))
  async getMyPreferences(@Request() req: AuthenticatedRequest) {
    const preferences = await this.preferencesService.getUserPreferences(
      req.user.id,
    );

    // Convert array to key-value object for easier frontend consumption
    const preferencesMap = preferences.reduce(
      (acc, pref) => {
        acc[pref.key] = pref.value;
        return acc;
      },
      {} as Record<string, unknown>,
    );

    return { data: preferencesMap };
  }

  /**
   * ROK-405: Self-delete account.
   * Requires user to type their display name or username to confirm.
   * Cascades all related data and reassigns events to the instance admin.
   */
  @Delete('me')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async deleteMyAccount(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    if (req.user.impersonatedBy) {
      throw new ForbiddenException('Cannot delete account while impersonating');
    }

    const dto = DeleteAccountSchema.parse(body);

    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Confirm name must match display name or username
    const expectedName = user.displayName || user.username;
    if (dto.confirmName !== expectedName) {
      throw new BadRequestException(
        'Confirmation name does not match your display name',
      );
    }

    // Find instance admin for event reassignment
    const admin = await this.usersService.findAdmin();
    // Reassign to admin, or if this user IS the admin, skip reassignment
    // (shouldn't happen in practice since admin is protected)
    const reassignTo =
      admin && admin.id !== req.user.id ? admin.id : req.user.id;

    // Delete custom avatar file from disk
    if (user.customAvatarUrl) {
      await this.avatarService.delete(user.customAvatarUrl);
    }

    await this.usersService.deleteUser(req.user.id, reassignTo);
  }

  /**
   * Unlink Discord from the current user's account.
   * Preserves the Discord ID for re-matching on future Discord logins.
   */
  @Delete('me/discord')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async unlinkDiscord(@Request() req: AuthenticatedRequest) {
    await this.usersService.unlinkDiscord(req.user.id);
  }

  /**
   * Get current user's game time (composite view: template + event commitments).
   * Optional `week` query param (ISO date of Sunday) defaults to current week.
   */
  @Get('me/game-time')
  @UseGuards(AuthGuard('jwt'))
  async getMyGameTime(
    @Request() req: AuthenticatedRequest,
    @Query('week') week?: string,
    @Query('tzOffset') tzOffsetStr?: string,
  ) {
    let weekStart: Date;
    if (week) {
      weekStart = new Date(week);
      if (isNaN(weekStart.getTime())) {
        throw new BadRequestException('Invalid week parameter');
      }
    } else {
      // Default to Sunday of the current week
      weekStart = new Date();
      const day = weekStart.getDay(); // 0=Sun, 1=Mon, ...
      weekStart.setDate(weekStart.getDate() - day);
      weekStart.setHours(0, 0, 0, 0);
    }

    // Parse timezone offset (minutes from UTC, e.g., -480 for PST)
    const tzOffset = tzOffsetStr ? parseInt(tzOffsetStr, 10) : 0;

    const result = await this.gameTimeService.getCompositeView(
      req.user.id,
      weekStart,
      isNaN(tzOffset) ? 0 : tzOffset,
    );
    return { data: result };
  }

  /**
   * Save current user's game time template (replaces all slots).
   */
  @Put('me/game-time')
  @UseGuards(AuthGuard('jwt'))
  async saveMyGameTime(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    try {
      const dto = GameTimeTemplateInputSchema.parse(body);
      const result = await this.gameTimeService.saveTemplate(
        req.user.id,
        dto.slots,
      );
      return { data: result };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
      }
      throw error;
    }
  }

  /**
   * Save per-hour date-specific overrides.
   */
  @Put('me/game-time/overrides')
  @UseGuards(AuthGuard('jwt'))
  async saveMyOverrides(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    try {
      const dto = GameTimeOverrideInputSchema.parse(body);
      await this.gameTimeService.saveOverrides(req.user.id, dto.overrides);
      return { data: { success: true } };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
      }
      throw error;
    }
  }

  /**
   * Create an absence range.
   */
  @Post('me/game-time/absences')
  @UseGuards(AuthGuard('jwt'))
  async createAbsence(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    try {
      const dto = GameTimeAbsenceInputSchema.parse(body);
      const result = await this.gameTimeService.createAbsence(req.user.id, dto);
      return { data: result };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
      }
      throw error;
    }
  }

  /**
   * Delete an absence.
   */
  @Delete('me/game-time/absences/:id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async deleteAbsence(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.gameTimeService.deleteAbsence(req.user.id, id);
  }

  /**
   * List all absences for current user.
   */
  @Get('me/game-time/absences')
  @UseGuards(AuthGuard('jwt'))
  async getAbsences(@Request() req: AuthenticatedRequest) {
    const absences = await this.gameTimeService.getAbsences(req.user.id);
    return { data: absences };
  }

  /**
   * Upload a custom avatar (ROK-220).
   * Validates image, processes to 256x256 WebP, saves to disk.
   */
  @Post('me/avatar')
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadAvatar(
    @Request() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    await this.avatarService.checkRateLimit(req.user.id);

    const processed = await this.avatarService.validateAndProcess(file.buffer);

    // Delete old custom avatar if exists
    const existing = await this.usersService.findById(req.user.id);
    if (existing?.customAvatarUrl) {
      await this.avatarService.delete(existing.customAvatarUrl);
    }

    const relativePath = await this.avatarService.save(req.user.id, processed);
    await this.usersService.setCustomAvatar(req.user.id, relativePath);

    return { data: { customAvatarUrl: relativePath } };
  }

  /**
   * Remove current user's custom avatar (ROK-220).
   */
  @Delete('me/avatar')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async deleteAvatar(@Request() req: AuthenticatedRequest) {
    const user = await this.usersService.findById(req.user.id);
    if (user?.customAvatarUrl) {
      await this.avatarService.delete(user.customAvatarUrl);
      await this.usersService.setCustomAvatar(req.user.id, null);
    }
  }

  /**
   * Operator+: remove any user's custom avatar (ROK-220 content moderation).
   */
  @Delete(':id/avatar')
  @UseGuards(AuthGuard('jwt'), OperatorGuard)
  @HttpCode(204)
  async adminDeleteAvatar(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.customAvatarUrl) {
      await this.avatarService.delete(user.customAvatarUrl);
      await this.usersService.setCustomAvatar(id, null);
    }
  }

  /**
   * List all users with role information (admin-only, ROK-272).
   * Used for the role management panel in admin settings.
   */
  @Get('management')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async listUsersForManagement(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('search') search?: string,
  ): Promise<UserManagementListResponseDto> {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitStr ?? '20', 10) || 20),
    );

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

  /**
   * Update a user's role (admin-only, ROK-272).
   * Can only promote/demote between member and operator.
   * Cannot promote to admin (only seed script or direct DB).
   */
  @Patch(':id/role')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = UpdateUserRoleSchema.parse(body);

    // Cannot change own role
    if (id === req.user.id) {
      throw new ForbiddenException('Cannot change your own role');
    }

    const targetUser = await this.usersService.findById(id);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Cannot change admin role via API
    if (targetUser.role === 'admin') {
      throw new ForbiddenException('Cannot modify admin role via API');
    }

    const updated = await this.usersService.setRole(id, dto.role);
    return {
      data: {
        id: updated.id,
        username: updated.username,
        role: updated.role,
      },
    };
  }

  /**
   * ROK-405: Admin-remove a user.
   * Cannot delete yourself or another admin.
   * Cascades all related data and reassigns events to the requesting admin.
   */
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @HttpCode(204)
  async adminRemoveUser(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ) {
    if (id === req.user.id) {
      throw new BadRequestException('Cannot delete yourself');
    }

    const targetUser = await this.usersService.findById(id);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    if (targetUser.role === 'admin') {
      throw new ForbiddenException('Cannot delete another admin');
    }

    // Delete custom avatar file from disk
    if (targetUser.customAvatarUrl) {
      await this.avatarService.delete(targetUser.customAvatarUrl);
    }

    // Reassign events to the admin performing the deletion
    await this.usersService.deleteUser(id, req.user.id);
  }

  /**
   * Update a user preference (ROK-195).
   * Requires JWT authentication. Validates input with Zod.
   */
  @Patch('me/preferences')
  @UseGuards(AuthGuard('jwt'))
  async updateMyPreference(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    try {
      const dto = UpdatePreferenceSchema.parse(body);
      const updated = await this.preferencesService.setUserPreference(
        req.user.id,
        dto.key,
        dto.value,
      );
      return { data: updated };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
      }
      throw error;
    }
  }
}
