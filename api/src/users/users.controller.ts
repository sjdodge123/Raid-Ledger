import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  NotFoundException,
  BadRequestException,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ZodError } from 'zod';
import { UsersService } from './users.service';
import { PreferencesService } from './preferences.service';
import { CharactersService } from '../characters/characters.service';
import { UserProfileDto, UpdatePreferenceSchema } from '@raid-ledger/contract';

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
    private readonly preferencesService: PreferencesService,
    private readonly charactersService: CharactersService,
  ) {}

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
