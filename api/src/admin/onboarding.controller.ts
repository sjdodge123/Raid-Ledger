import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
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
  DataSourceStatusDto,
} from '@raid-ledger/contract';
import {
  ChangePasswordSchema,
  CommunityIdentitySchema,
  UpdateStepSchema,
} from '@raid-ledger/contract';
import type { UpdateStepDto } from '@raid-ledger/contract';
import { Req } from '@nestjs/common';
import type { AuthenticatedExpressRequest } from '../auth/types';

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
    const settings = await this.fetchOnboardingSettings();
    return this.buildStatusDto(settings);
  }

  private async fetchOnboardingSettings() {
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
    return {
      completedRaw,
      currentStepRaw,
      communityName,
      defaultTimezone,
      blizzardConfigured,
      igdbConfigured,
      discordConfigured,
    };
  }

  private buildStatusDto(
    s: Awaited<ReturnType<OnboardingController['fetchOnboardingSettings']>>,
  ): OnboardingStatusDto {
    return {
      completed: s.completedRaw === 'true',
      currentStep: Math.min(
        s.currentStepRaw ? parseInt(s.currentStepRaw, 10) : 0,
        3,
      ),
      steps: {
        secureAccount: false,
        communityIdentity: !!(s.communityName || s.defaultTimezone),
        connectPlugins:
          s.blizzardConfigured || s.igdbConfigured || s.discordConfigured,
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
   * POST /admin/onboarding/reset
   * Reset onboarding so the wizard can be re-run.
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async reset(): Promise<{ success: boolean }> {
    await this.settingsService.set(SETTING_KEYS.ONBOARDING_COMPLETED, 'false');
    await this.settingsService.set(SETTING_KEYS.ONBOARDING_CURRENT_STEP, '0');
    this.logger.log('Admin onboarding reset for re-run');
    return { success: true };
  }

  /**
   * PATCH /admin/onboarding/step
   * Save the current step index for resumability.
   */
  @Patch('step')
  @HttpCode(HttpStatus.OK)
  async updateStep(
    @Body() body: UpdateStepDto,
  ): Promise<{ success: boolean; step: number }> {
    const parsed = UpdateStepSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.errors.map((e) => e.message).join(', '),
      );
    }

    const { step } = parsed.data;
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
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<{ success: boolean; message: string }> {
    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.errors.map((e) => e.message).join(', '),
      );
    }

    const localCred = await this.findLocalCredential(req.user.id);
    await this.verifyCurrentPassword(
      parsed.data.currentPassword,
      localCred.passwordHash,
    );
    await this.updatePassword(localCred.id, parsed.data.newPassword);

    this.logger.log(
      `Admin user ${req.user.username} changed password via onboarding`,
    );
    return { success: true, message: 'Password changed successfully' };
  }

  private async findLocalCredential(userId: number) {
    const [localCred] = await this.db
      .select()
      .from(schema.localCredentials)
      .where(eq(schema.localCredentials.userId, userId))
      .limit(1);
    if (!localCred) {
      throw new BadRequestException(
        'No local credentials found for this admin account',
      );
    }
    return localCred;
  }

  private async verifyCurrentPassword(currentPassword: string, hash: string) {
    const isValid = await bcrypt.compare(currentPassword, hash);
    if (!isValid)
      throw new UnauthorizedException('Current password is incorrect');
  }

  private async updatePassword(credId: number, newPassword: string) {
    const newHash = await this.localAuthService.hashPassword(newPassword);
    await this.db
      .update(schema.localCredentials)
      .set({ passwordHash: newHash })
      .where(eq(schema.localCredentials.id, credId));
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
  // Step 3: Connect Data Sources (used by plugins step)
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
