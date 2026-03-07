/**
 * Controller for /users/me endpoints (current user).
 * Extracted from users.controller.ts for file size compliance (ROK-711).
 */
import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  ParseIntPipe,
  Param,
  BadRequestException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  HttpCode,
  Header,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { PreferencesService } from './preferences.service';
import { GameTimeService } from './game-time.service';
import {
  UpdatePreferenceSchema,
  UpdatePreferenceBatchSchema,
  GameTimeTemplateInputSchema,
  GameTimeOverrideInputSchema,
  GameTimeAbsenceInputSchema,
  UpdateUserProfileSchema,
  CheckDisplayNameQuerySchema,
  type UserRole,
  type DiscordMembershipResponseDto,
} from '@raid-ledger/contract';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import {
  parseOrBadRequest,
  resolveWeekStart,
} from './users-controller.helpers';
import {
  checkGuildMembership,
  validateAndDeleteAccount,
} from './users-me-discord.helpers';

interface AuthenticatedRequest {
  user: { id: number; role: UserRole; impersonatedBy?: number | null };
}

/** Controller for /users/me/* (current user) and /users/check-display-name. */
@Controller('users')
export class UsersMeController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatarService: AvatarService,
    private readonly preferencesService: PreferencesService,
    private readonly gameTimeService: GameTimeService,
    private readonly discordBotClientService: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
  ) {}

  /** Check if a display name is available (ROK-219). */
  @Get('check-display-name')
  @UseGuards(AuthGuard('jwt'))
  async checkDisplayName(
    @Request() req: AuthenticatedRequest,
    @Query('name') name?: string,
  ) {
    if (!name)
      throw new BadRequestException('name query parameter is required');
    const parsed = parseOrBadRequest(CheckDisplayNameQuerySchema, { name });
    const available = await this.usersService.checkDisplayNameAvailability(
      parsed.name,
      req.user.id,
    );
    return { available };
  }

  /** Update current user's profile (display name) (ROK-219). */
  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  async updateMyProfile(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = parseOrBadRequest(UpdateUserProfileSchema, body);
    const available = await this.usersService.checkDisplayNameAvailability(
      dto.displayName,
      req.user.id,
    );
    if (!available)
      throw new BadRequestException('Display name is already taken');
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
  }

  /** Mark FTE onboarding as completed (ROK-219). */
  @Post('me/complete-onboarding')
  @UseGuards(AuthGuard('jwt'))
  async completeOnboarding(@Request() req: AuthenticatedRequest) {
    const updated = await this.usersService.completeOnboarding(req.user.id);
    return {
      success: true,
      onboardingCompletedAt: updated.onboardingCompletedAt!.toISOString(),
    };
  }

  /** Reset onboarding to allow wizard re-run (ROK-219). */
  @Post('me/reset-onboarding')
  @UseGuards(AuthGuard('jwt'))
  async resetOnboarding(@Request() req: AuthenticatedRequest) {
    await this.usersService.resetOnboarding(req.user.id);
    return { success: true };
  }

  /** Check if current user is a Discord guild member (ROK-425). */
  @Get('me/discord-membership')
  @UseGuards(AuthGuard('jwt'))
  async getDiscordMembership(
    @Request() req: AuthenticatedRequest,
  ): Promise<DiscordMembershipResponseDto> {
    if (!this.discordBotClientService.isConnected())
      return { botConnected: false };
    const guildInfo = this.discordBotClientService.getGuildInfo();
    if (!guildInfo) return { botConnected: false };
    const user = await this.usersService.findById(req.user.id);
    if (
      !user?.discordId ||
      user.discordId.startsWith('local:') ||
      user.discordId.startsWith('unlinked:')
    ) {
      return { botConnected: true, guildName: guildInfo.name, isMember: false };
    }
    return checkGuildMembership(
      this.discordBotClientService,
      this.channelResolver,
      user.discordId,
      guildInfo.name,
    );
  }

  /** Get current user's preferences (ROK-195). */
  @Get('me/preferences')
  @UseGuards(AuthGuard('jwt'))
  async getMyPreferences(@Request() req: AuthenticatedRequest) {
    const preferences = await this.preferencesService.getUserPreferences(
      req.user.id,
    );
    const preferencesMap = preferences.reduce(
      (acc, pref) => {
        acc[pref.key] = pref.value;
        return acc;
      },
      {} as Record<string, unknown>,
    );
    return { data: preferencesMap };
  }

  /** Update a user preference (ROK-195). */
  @Patch('me/preferences')
  @UseGuards(AuthGuard('jwt'))
  async updateMyPreference(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const batchResult = UpdatePreferenceBatchSchema.safeParse(body);
    if (batchResult.success) {
      await this.preferencesService.setUserPreferences(
        req.user.id,
        batchResult.data.preferences,
      );
      return {
        data: { updated: Object.keys(batchResult.data.preferences).length },
      };
    }
    const dto = parseOrBadRequest(UpdatePreferenceSchema, body);
    const updated = await this.preferencesService.setUserPreference(
      req.user.id,
      dto.key,
      dto.value,
    );
    return { data: updated };
  }

  /** Self-delete account (ROK-405). */
  @Delete('me')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async deleteMyAccount(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    await validateAndDeleteAccount(
      req.user,
      body,
      this.usersService,
      this.avatarService,
    );
  }

  /** Unlink Discord from current user's account. */
  @Delete('me/discord')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async unlinkDiscord(@Request() req: AuthenticatedRequest) {
    await this.usersService.unlinkDiscord(req.user.id);
  }

  /** Get current user's game time (composite view). */
  @Get('me/game-time')
  @UseGuards(AuthGuard('jwt'))
  @Header('Cache-Control', 'private, max-age=120')
  async getMyGameTime(
    @Request() req: AuthenticatedRequest,
    @Query('week') week?: string,
    @Query('tzOffset') tzOffsetStr?: string,
  ) {
    const weekStart = resolveWeekStart(week);
    const tzOffset = tzOffsetStr ? parseInt(tzOffsetStr, 10) : 0;
    const result = await this.gameTimeService.getCompositeView(
      req.user.id,
      weekStart,
      isNaN(tzOffset) ? 0 : tzOffset,
    );
    return { data: result };
  }

  /** Save game time template. */
  @Put('me/game-time')
  @UseGuards(AuthGuard('jwt'))
  async saveMyGameTime(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = parseOrBadRequest(GameTimeTemplateInputSchema, body);
    const result = await this.gameTimeService.saveTemplate(
      req.user.id,
      dto.slots,
    );
    return { data: result };
  }

  /** Save per-hour date-specific overrides. */
  @Put('me/game-time/overrides')
  @UseGuards(AuthGuard('jwt'))
  async saveMyOverrides(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = parseOrBadRequest(GameTimeOverrideInputSchema, body);
    await this.gameTimeService.saveOverrides(req.user.id, dto.overrides);
    return { data: { success: true } };
  }

  /** Create an absence range. */
  @Post('me/game-time/absences')
  @UseGuards(AuthGuard('jwt'))
  async createAbsence(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = parseOrBadRequest(GameTimeAbsenceInputSchema, body);
    const result = await this.gameTimeService.createAbsence(req.user.id, dto);
    return { data: result };
  }

  /** Delete an absence. */
  @Delete('me/game-time/absences/:id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async deleteAbsence(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.gameTimeService.deleteAbsence(req.user.id, id);
  }

  /** List all absences for current user. */
  @Get('me/game-time/absences')
  @UseGuards(AuthGuard('jwt'))
  async getAbsences(@Request() req: AuthenticatedRequest) {
    return { data: await this.gameTimeService.getAbsences(req.user.id) };
  }

  /** Upload a custom avatar (ROK-220). */
  @Post('me/avatar')
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadAvatar(
    @Request() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    await this.avatarService.checkRateLimit(req.user.id);
    const processed = await this.avatarService.validateAndProcess(file.buffer);
    const existing = await this.usersService.findById(req.user.id);
    if (existing?.customAvatarUrl)
      await this.avatarService.delete(existing.customAvatarUrl);
    const relativePath = await this.avatarService.save(req.user.id, processed);
    await this.usersService.setCustomAvatar(req.user.id, relativePath);
    return { data: { customAvatarUrl: relativePath } };
  }

  /** Remove current user's custom avatar (ROK-220). */
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
}
