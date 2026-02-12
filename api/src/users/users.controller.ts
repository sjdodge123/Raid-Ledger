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
import {
  UserProfileDto,
  PlayersListResponseDto,
  UpdatePreferenceSchema,
  GameTimeTemplateInputSchema,
  GameTimeOverrideInputSchema,
  GameTimeAbsenceInputSchema,
} from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: {
    id: number;
    isAdmin: boolean;
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
  ) {}

  /**
   * List all registered players (paginated, with optional search).
   * Public endpoint for the Players page.
   */
  @Get()
  async listPlayers(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('search') search?: string,
  ): Promise<PlayersListResponseDto> {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitStr ?? '20', 10) || 20),
    );

    const result = await this.usersService.findAll(
      page,
      limit,
      search || undefined,
    );
    return {
      data: result.data,
      meta: { total: result.total, page, limit },
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
        customAvatarUrl: user.customAvatarUrl || null,
        createdAt: user.createdAt.toISOString(),
        characters: charactersResult.data,
      },
    };
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
   * Admin: remove any user's custom avatar (ROK-220 content moderation).
   */
  @Delete(':id/avatar')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async adminDeleteAvatar(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (!req.user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
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
