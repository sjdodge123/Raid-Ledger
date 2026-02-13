import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  UseGuards,
  Inject,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { LocalAuthService } from '../auth/local-auth.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import * as bcrypt from 'bcrypt';
import type {
  OnboardingStatusDto,
  ChangePasswordDto,
  CommunityIdentityDto,
  OnboardingGameListDto,
  DataSourceStatusDto,
} from '@raid-ledger/contract';
import {
  ChangePasswordSchema,
  CommunityIdentitySchema,
} from '@raid-ledger/contract';
import { Request } from 'express';
import { Req } from '@nestjs/common';

import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest extends Request {
  user: { id: number; username: string; role: UserRole };
}

/**
 * Admin Onboarding Wizard Controller (ROK-204)
 * Provides endpoints for the step-by-step admin setup wizard.
 */
@Controller('admin/onboarding')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly localAuthService: LocalAuthService,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * GET /admin/onboarding/status
   * Returns which steps are complete and whether onboarding is finished.
   */
  @Get('status')
  async getStatus(): Promise<OnboardingStatusDto> {
    const [
      completedRaw,
      currentStepRaw,
      communityName,
      defaultTimezone,
      blizzardConfigured,
      igdbConfigured,
      discordConfigured,
    ] = await Promise.all([
      this.settingsService.get(SETTING_KEYS.ONBOARDING_COMPLETED),
      this.settingsService.get(SETTING_KEYS.ONBOARDING_CURRENT_STEP),
      this.settingsService.get(SETTING_KEYS.COMMUNITY_NAME),
      this.settingsService.get(SETTING_KEYS.DEFAULT_TIMEZONE),
      this.settingsService.isBlizzardConfigured(),
      this.settingsService.isIgdbConfigured(),
      this.settingsService.isDiscordConfigured(),
    ]);

    const completed = completedRaw === 'true';
    const currentStep = currentStepRaw ? parseInt(currentStepRaw, 10) : 0;

    // Determine step completion heuristically
    const secureAccount = false; // We can't determine if password was changed, so always show as available
    const communityIdentity = !!(communityName || defaultTimezone);
    const chooseGames = true; // Games are pre-enabled, so this is "done" by default
    const connectDataSources =
      blizzardConfigured || igdbConfigured || discordConfigured;

    return {
      completed,
      currentStep: Math.min(currentStep, 4),
      steps: {
        secureAccount,
        communityIdentity,
        chooseGames,
        connectDataSources,
      },
    };
  }

  /**
   * POST /admin/onboarding/complete
   * Mark onboarding as completed. Sets onboarding_completed = true.
   */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async complete(): Promise<{ success: boolean }> {
    await this.settingsService.set(SETTING_KEYS.ONBOARDING_COMPLETED, 'true');
    this.logger.log('Admin onboarding marked as completed');
    return { success: true };
  }

  /**
   * PATCH /admin/onboarding/step
   * Save the current step index for resumability.
   */
  @Patch('step')
  @HttpCode(HttpStatus.OK)
  async updateStep(
    @Body() body: { step: number },
  ): Promise<{ success: boolean; step: number }> {
    const step = Math.max(0, Math.min(4, body.step));
    await this.settingsService.set(
      SETTING_KEYS.ONBOARDING_CURRENT_STEP,
      String(step),
    );
    return { success: true, step };
  }

  // ============================================================
  // Step 1: Secure Account
  // ============================================================

  /**
   * POST /admin/onboarding/change-password
   * Change the admin's password.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; message: string }> {
    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.errors.map((e) => e.message).join(', '),
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    // Find the local credential for the current admin
    const [localCred] = await this.db
      .select()
      .from(schema.localCredentials)
      .where(eq(schema.localCredentials.userId, req.user.id))
      .limit(1);

    if (!localCred) {
      throw new BadRequestException(
        'No local credentials found for this admin account',
      );
    }

    // Verify current password
    const isValid = await bcrypt.compare(
      currentPassword,
      localCred.passwordHash,
    );
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Hash and save new password
    const newHash = await this.localAuthService.hashPassword(newPassword);
    await this.db
      .update(schema.localCredentials)
      .set({ passwordHash: newHash })
      .where(eq(schema.localCredentials.id, localCred.id));

    this.logger.log(
      `Admin user ${req.user.username} changed password via onboarding`,
    );

    return {
      success: true,
      message: 'Password changed successfully',
    };
  }

  // ============================================================
  // Step 2: Community Identity
  // ============================================================

  /**
   * PATCH /admin/onboarding/community
   * Save community identity settings.
   */
  @Patch('community')
  @HttpCode(HttpStatus.OK)
  async updateCommunity(
    @Body() body: CommunityIdentityDto,
  ): Promise<{ success: boolean; message: string }> {
    const parsed = CommunityIdentitySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.errors.map((e) => e.message).join(', '),
      );
    }

    const { communityName, defaultTimezone } = parsed.data;

    if (communityName) {
      await this.settingsService.setCommunityName(communityName.trim());
    }

    if (defaultTimezone) {
      await this.settingsService.set(
        SETTING_KEYS.DEFAULT_TIMEZONE,
        defaultTimezone,
      );
    }

    this.logger.log('Community identity updated via onboarding');

    return {
      success: true,
      message: 'Community settings saved',
    };
  }

  // ============================================================
  // Step 3: Choose Games
  // ============================================================

  /**
   * GET /admin/onboarding/games
   * List all games from game_registry with their enabled status.
   */
  @Get('games')
  async listGames(): Promise<OnboardingGameListDto> {
    const games = await this.db
      .select({
        id: schema.gameRegistry.id,
        slug: schema.gameRegistry.slug,
        name: schema.gameRegistry.name,
        iconUrl: schema.gameRegistry.iconUrl,
        colorHex: schema.gameRegistry.colorHex,
        enabled: schema.gameRegistry.enabled,
      })
      .from(schema.gameRegistry)
      .orderBy(schema.gameRegistry.name);

    const enabledCount = games.filter((g) => g.enabled).length;

    return {
      data: games,
      meta: {
        total: games.length,
        enabledCount,
      },
    };
  }

  /**
   * PATCH /admin/onboarding/games/:id
   * Toggle a game's enabled status.
   */
  @Patch('games/:id')
  @HttpCode(HttpStatus.OK)
  async toggleGame(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ): Promise<{ success: boolean; id: string; enabled: boolean }> {
    const existing = await this.db
      .select({ id: schema.gameRegistry.id })
      .from(schema.gameRegistry)
      .where(eq(schema.gameRegistry.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new BadRequestException('Game not found');
    }

    await this.db
      .update(schema.gameRegistry)
      .set({ enabled: body.enabled })
      .where(eq(schema.gameRegistry.id, id));

    return { success: true, id, enabled: body.enabled };
  }

  /**
   * POST /admin/onboarding/games/bulk-toggle
   * Enable or disable multiple games at once.
   */
  @Post('games/bulk-toggle')
  @HttpCode(HttpStatus.OK)
  async bulkToggleGames(
    @Body() body: { ids: string[]; enabled: boolean },
  ): Promise<{ success: boolean; count: number }> {
    if (!body.ids || body.ids.length === 0) {
      return { success: true, count: 0 };
    }

    // Use a transaction for atomicity
    let count = 0;
    await this.db.transaction(async (tx) => {
      for (const id of body.ids) {
        await tx
          .update(schema.gameRegistry)
          .set({ enabled: body.enabled })
          .where(eq(schema.gameRegistry.id, id));
        count++;
      }
    });

    return { success: true, count };
  }

  // ============================================================
  // Step 4: Connect Data Sources
  // ============================================================

  /**
   * GET /admin/onboarding/data-sources
   * Returns configuration status for all data source integrations.
   */
  @Get('data-sources')
  async getDataSourceStatus(): Promise<DataSourceStatusDto> {
    const [blizzardConfigured, igdbConfigured, discordConfigured] =
      await Promise.all([
        this.settingsService.isBlizzardConfigured(),
        this.settingsService.isIgdbConfigured(),
        this.settingsService.isDiscordConfigured(),
      ]);

    return {
      blizzard: { configured: blizzardConfigured },
      igdb: { configured: igdbConfigured },
      discord: { configured: discordConfigured },
    };
  }
}
