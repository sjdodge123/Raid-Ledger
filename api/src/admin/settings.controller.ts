import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { IgdbService } from '../igdb/igdb.service';
import { DemoDataService } from './demo-data.service';
import type {
  DemoDataStatusDto,
  DemoDataResultDto,
  SteamConfigStatusDto,
} from '@raid-ledger/contract';
import { testDiscordOAuth } from './settings-oauth.helpers';
import {
  testIgdbCredentials,
  testBlizzardCredentials,
  testSteamApiKey,
} from './settings-api-test.helpers';
import {
  OAuthConfigDto,
  IgdbConfigDto,
  BlizzardConfigDto,
  SteamConfigDto,
} from './settings.dto';
import type {
  OAuthStatusResponse,
  IgdbStatusResponse,
  BlizzardStatusResponse,
  OAuthTestResponse,
} from './settings.dto';

// Re-export DTOs/interfaces for consumers importing from this file
export type {
  OAuthStatusResponse,
  IgdbStatusResponse,
  BlizzardStatusResponse,
  OAuthTestResponse,
} from './settings.dto';

/**
 * Admin Settings Controller (ROK-146)
 * Provides endpoints for managing OAuth configuration via the admin UI.
 */
@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminSettingsController {
  private readonly logger = new Logger(AdminSettingsController.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly igdbService: IgdbService,
    private readonly demoDataService: DemoDataService,
  ) {}

  // ── OAuth ───────────────────────────────────────────────
  @Get('oauth')
  async getOAuthStatus(): Promise<OAuthStatusResponse> {
    const config = await this.settingsService.getDiscordOAuthConfig();
    return {
      configured: config !== null,
      callbackUrl: config?.callbackUrl ?? null,
    };
  }

  @Put('oauth')
  @HttpCode(HttpStatus.OK)
  async updateOAuthConfig(
    @Body() body: OAuthConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.settingsService.setDiscordOAuthConfig({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      callbackUrl:
        body.callbackUrl || 'http://localhost:3000/auth/discord/callback',
    });
    this.logger.log('Discord OAuth configuration updated via admin UI');
    return {
      success: true,
      message:
        'Discord OAuth configuration saved. Discord login is now enabled.',
    };
  }

  @Post('oauth/test')
  @HttpCode(HttpStatus.OK)
  async testOAuthConfig(): Promise<OAuthTestResponse> {
    const config = await this.settingsService.getDiscordOAuthConfig();
    if (!config)
      return { success: false, message: 'Discord OAuth is not configured' };
    return testDiscordOAuth(config);
  }

  @Post('oauth/clear')
  @HttpCode(HttpStatus.OK)
  async clearOAuthConfig(): Promise<{ success: boolean; message: string }> {
    await Promise.all([
      this.settingsService.delete(SETTING_KEYS.DISCORD_CLIENT_ID),
      this.settingsService.delete(SETTING_KEYS.DISCORD_CLIENT_SECRET),
      this.settingsService.delete(SETTING_KEYS.DISCORD_CALLBACK_URL),
    ]);
    this.logger.log('Discord OAuth configuration cleared via admin UI');
    return { success: true, message: 'Discord OAuth configuration cleared.' };
  }

  // ── IGDB ────────────────────────────────────────────────
  @Get('igdb')
  async getIgdbStatus(): Promise<IgdbStatusResponse> {
    const configured = await this.settingsService.isIgdbConfigured();
    const health = configured ? this.igdbService.getHealthStatus() : undefined;
    return { configured, health };
  }

  @Put('igdb')
  @HttpCode(HttpStatus.OK)
  async updateIgdbConfig(
    @Body() body: IgdbConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.settingsService.setIgdbConfig({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
    });
    this.logger.log('IGDB configuration updated via admin UI');
    return {
      success: true,
      message: 'IGDB configuration saved. Game discovery is now enabled.',
    };
  }

  @Post('igdb/test')
  @HttpCode(HttpStatus.OK)
  async testIgdbConfig(): Promise<OAuthTestResponse> {
    const config = await this.settingsService.getIgdbConfig();
    if (!config) return { success: false, message: 'IGDB is not configured' };
    return testIgdbCredentials(config);
  }

  @Post('igdb/clear')
  @HttpCode(HttpStatus.OK)
  async clearIgdbConfig(): Promise<{ success: boolean; message: string }> {
    await Promise.all([
      this.settingsService.delete(SETTING_KEYS.IGDB_CLIENT_ID),
      this.settingsService.delete(SETTING_KEYS.IGDB_CLIENT_SECRET),
    ]);
    this.settingsService['eventEmitter'].emit('settings.igdb.updated', null);
    this.logger.log('IGDB configuration cleared via admin UI');
    return { success: true, message: 'IGDB configuration cleared.' };
  }

  // ── Blizzard ────────────────────────────────────────────
  @Get('blizzard')
  async getBlizzardStatus(): Promise<BlizzardStatusResponse> {
    return { configured: await this.settingsService.isBlizzardConfigured() };
  }

  @Put('blizzard')
  @HttpCode(HttpStatus.OK)
  async updateBlizzardConfig(
    @Body() body: BlizzardConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.settingsService.setBlizzardConfig({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
    });
    this.logger.log('Blizzard API configuration updated via admin UI');
    return {
      success: true,
      message:
        'Blizzard API configuration saved. WoW Armory import is now enabled.',
    };
  }

  @Post('blizzard/test')
  @HttpCode(HttpStatus.OK)
  async testBlizzardConfig(): Promise<OAuthTestResponse> {
    const config = await this.settingsService.getBlizzardConfig();
    if (!config)
      return { success: false, message: 'Blizzard API is not configured' };
    return testBlizzardCredentials(config);
  }

  @Post('blizzard/clear')
  @HttpCode(HttpStatus.OK)
  async clearBlizzardConfig(): Promise<{ success: boolean; message: string }> {
    await Promise.all([
      this.settingsService.delete(SETTING_KEYS.BLIZZARD_CLIENT_ID),
      this.settingsService.delete(SETTING_KEYS.BLIZZARD_CLIENT_SECRET),
    ]);
    this.settingsService['eventEmitter'].emit(
      'settings.blizzard.updated',
      null,
    );
    this.logger.log('Blizzard API configuration cleared via admin UI');
    return { success: true, message: 'Blizzard API configuration cleared.' };
  }

  // ── Timezone ────────────────────────────────────────────
  @Get('timezone')
  async getTimezone(): Promise<{ timezone: string | null }> {
    return { timezone: await this.settingsService.getDefaultTimezone() };
  }

  @Put('timezone')
  @HttpCode(HttpStatus.OK)
  async updateTimezone(
    @Body() body: { timezone?: string | null },
  ): Promise<{ success: boolean; message: string }> {
    const { timezone } = body;
    if (!timezone) {
      await this.settingsService.delete(SETTING_KEYS.DEFAULT_TIMEZONE);
      this.logger.log('Default timezone cleared (UTC fallback) via admin UI');
      return {
        success: true,
        message: 'Default timezone cleared (UTC fallback).',
      };
    }
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new BadRequestException(`Invalid timezone: ${timezone}`);
    }
    await this.settingsService.setDefaultTimezone(timezone);
    this.logger.log(`Default timezone updated to ${timezone} via admin UI`);
    return { success: true, message: `Default timezone set to ${timezone}.` };
  }

  // ── Demo Data ───────────────────────────────────────────
  @Get('demo/status')
  async getDemoStatus(): Promise<DemoDataStatusDto> {
    return this.demoDataService.getStatus();
  }
  @Post('demo/install')
  @HttpCode(HttpStatus.OK)
  async installDemoData(): Promise<DemoDataResultDto> {
    return this.demoDataService.installDemoData();
  }
  @Post('demo/clear')
  @HttpCode(HttpStatus.OK)
  async clearDemoData(): Promise<DemoDataResultDto> {
    return this.demoDataService.clearDemoData();
  }

  /** Link a Discord ID to a user — DEMO_MODE only (smoke tests). */
  @Post('demo/link-discord')
  @HttpCode(HttpStatus.OK)
  async linkDiscordForTest(
    @Body() body: { userId: number; discordId: string; username: string },
  ) {
    const user = await this.demoDataService.linkDiscordForTest(
      body.userId,
      body.discordId,
      body.username,
    );
    return { success: true, user };
  }

  /** Create a signup for any user — DEMO_MODE only (smoke tests). */
  @Post('demo/signup')
  @HttpCode(HttpStatus.OK)
  async createSignupForTest(
    @Body()
    body: {
      eventId: number;
      userId: number;
      preferredRoles?: string[];
      characterId?: string;
      status?: string;
    },
  ) {
    return this.demoDataService.createSignupForTest(
      body.eventId,
      body.userId,
      {
        preferredRoles: body.preferredRoles,
        characterId: body.characterId,
        status: body.status,
      },
    );
  }

  // ── Steam ───────────────────────────────────────────────
  @Get('steam')
  async getSteamStatus(): Promise<SteamConfigStatusDto> {
    return { configured: await this.settingsService.isSteamConfigured() };
  }

  @Put('steam')
  @HttpCode(HttpStatus.OK)
  async updateSteamConfig(@Body() body: SteamConfigDto) {
    await this.settingsService.setSteamApiKey(body.apiKey.trim());
    this.logger.log('Steam API key updated via admin UI');
    return {
      success: true,
      message: 'Steam API key saved. Steam library sync is now enabled.',
    };
  }

  @Post('steam/test')
  @HttpCode(HttpStatus.OK)
  async testSteamConfig(): Promise<OAuthTestResponse> {
    const apiKey = await this.settingsService.getSteamApiKey();
    if (!apiKey)
      return { success: false, message: 'Steam API key is not configured' };
    return testSteamApiKey(apiKey);
  }

  @Post('steam/clear')
  @HttpCode(HttpStatus.OK)
  async clearSteamConfig() {
    await this.settingsService.clearSteamConfig();
    this.logger.log('Steam API key cleared via admin UI');
    return { success: true, message: 'Steam API key cleared.' };
  }

  // ── GitHub (deprecated ROK-306) ─────────────────────────
  /** @deprecated ROK-306 — GitHub PAT replaced by Sentry. */
  @Get('github')
  getGitHubStatus() {
    return {
      configured: false,
      deprecated: true,
      message:
        'GitHub PAT integration has been replaced by Sentry error tracking (ROK-306).',
    };
  }
  /** @deprecated ROK-306 */
  @Put('github')
  @HttpCode(HttpStatus.OK)
  updateGitHubConfig() {
    return {
      success: false,
      message:
        'GitHub PAT integration has been replaced by Sentry error tracking (ROK-306). No configuration needed.',
    };
  }
  /** @deprecated ROK-306 */
  @Post('github/test')
  @HttpCode(HttpStatus.OK)
  testGitHubConfig(): OAuthTestResponse {
    return {
      success: false,
      message:
        'GitHub PAT integration has been replaced by Sentry error tracking (ROK-306).',
    };
  }
  /** @deprecated ROK-306 */
  @Post('github/clear')
  @HttpCode(HttpStatus.OK)
  async clearGitHubConfig() {
    await this.settingsService.delete(SETTING_KEYS.GITHUB_PAT);
    return {
      success: true,
      message:
        'GitHub PAT cleared. Feedback is now handled by Sentry error tracking.',
    };
  }
}
