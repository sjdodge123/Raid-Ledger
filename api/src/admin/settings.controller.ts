import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { IsNotEmpty, IsString, IsUrl, IsOptional } from 'class-validator';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { IgdbService } from '../igdb/igdb.service';
import { DemoDataService } from './demo-data.service';
import {
  IgdbSyncStatusDto,
  IgdbHealthStatusDto,
  AdminGameListResponseDto,
  DemoDataStatusDto,
  DemoDataResultDto,
} from '@raid-ledger/contract';
import { and, eq, ilike, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

export interface OAuthStatusResponse {
  configured: boolean;
  callbackUrl: string | null;
}

export interface IgdbStatusResponse {
  configured: boolean;
  health?: IgdbHealthStatusDto;
}

export interface BlizzardStatusResponse {
  configured: boolean;
}

export class BlizzardConfigDto {
  @IsString()
  @IsNotEmpty({ message: 'Client ID is required' })
  clientId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Client Secret is required' })
  clientSecret!: string;
}

export class OAuthConfigDto {
  @IsString()
  @IsNotEmpty({ message: 'Client ID is required' })
  clientId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Client Secret is required' })
  clientSecret!: string;

  @IsOptional()
  @IsUrl(
    { require_tld: false },
    { message: 'Callback URL must be a valid URL' },
  )
  callbackUrl?: string;
}

export class IgdbConfigDto {
  @IsString()
  @IsNotEmpty({ message: 'Client ID is required' })
  clientId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Client Secret is required' })
  clientSecret!: string;
}

export interface OAuthTestResponse {
  success: boolean;
  message: string;
}

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

  /**
   * GET /admin/settings/oauth
   * Returns current OAuth configuration status (not credentials).
   */
  @Get('oauth')
  async getOAuthStatus(): Promise<OAuthStatusResponse> {
    const config = await this.settingsService.getDiscordOAuthConfig();

    return {
      configured: config !== null,
      callbackUrl: config?.callbackUrl ?? null,
    };
  }

  /**
   * PUT /admin/settings/oauth
   * Update Discord OAuth credentials.
   */
  @Put('oauth')
  @HttpCode(HttpStatus.OK)
  async updateOAuthConfig(
    @Body() body: OAuthConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    const { clientId, clientSecret, callbackUrl } = body;

    await this.settingsService.setDiscordOAuthConfig({
      clientId,
      clientSecret,
      callbackUrl: callbackUrl || 'http://localhost:3000/auth/discord/callback',
    });

    this.logger.log('Discord OAuth configuration updated via admin UI');

    return {
      success: true,
      message:
        'Discord OAuth configuration saved. Discord login is now enabled.',
    };
  }

  /**
   * POST /admin/settings/oauth/test
   * Test Discord OAuth credentials by making a token request.
   */
  @Post('oauth/test')
  @HttpCode(HttpStatus.OK)
  async testOAuthConfig(): Promise<OAuthTestResponse> {
    const config = await this.settingsService.getDiscordOAuthConfig();

    if (!config) {
      return {
        success: false,
        message: 'Discord OAuth is not configured',
      };
    }

    const headers = {
      'User-Agent':
        'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)',
    };

    try {
      // Step 1: Try token endpoint to fully validate credentials.
      const basicAuth = Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString('base64');

      const tokenResponse = await fetch(
        'https://discord.com/api/v10/oauth2/token',
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
          },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            scope: 'identify',
          }),
        },
      );

      const tokenText = await tokenResponse.text();
      let tokenData: { error?: string } | null = null;
      try {
        tokenData = JSON.parse(tokenText) as { error?: string };
      } catch {
        // Non-JSON response — likely Cloudflare HTML block, handled below
      }

      // If we got a proper JSON response, we can validate credentials directly
      if (tokenData) {
        if (
          tokenResponse.status === 401 ||
          tokenData.error === 'invalid_client'
        ) {
          return {
            success: false,
            message: 'Invalid Client ID or Client Secret',
          };
        }

        if (
          tokenResponse.status === 400 &&
          tokenData.error === 'unsupported_grant_type'
        ) {
          return {
            success: true,
            message: 'Credentials are valid! Discord OAuth is ready to use.',
          };
        }

        if (tokenResponse.ok) {
          return {
            success: true,
            message: 'Credentials verified successfully!',
          };
        }

        if (tokenResponse.status === 429) {
          // JSON 429 — real Discord rate limit, fall through to gateway check
        } else {
          return {
            success: false,
            message: `Discord returned an error: ${tokenData.error || tokenResponse.status}`,
          };
        }
      }

      // Step 2: Token endpoint blocked (Cloudflare HTML 429 or JSON 429).
      // Fall back to a lightweight GET to confirm Discord API is reachable.
      // The actual credential validation will happen on first OAuth login.
      this.logger.warn(
        `Token endpoint blocked (${tokenResponse.status}), falling back to gateway check`,
      );

      const gatewayResponse = await fetch(
        'https://discord.com/api/v10/gateway',
        { headers },
      );

      if (gatewayResponse.ok) {
        return {
          success: true,
          message:
            'Discord API is reachable. Credentials are saved — they will be validated on first login.',
        };
      }

      return {
        success: false,
        message: `Discord API is unreachable (HTTP ${gatewayResponse.status}). The server's IP may be blocked by Cloudflare.`,
      };
    } catch (error) {
      this.logger.error('Failed to test Discord OAuth:', error);
      return {
        success: false,
        message: 'Failed to connect to Discord API. Please check your network.',
      };
    }
  }

  /**
   * POST /admin/settings/oauth/clear
   * Remove Discord OAuth configuration.
   */
  @Post('oauth/clear')
  @HttpCode(HttpStatus.OK)
  async clearOAuthConfig(): Promise<{ success: boolean; message: string }> {
    await Promise.all([
      this.settingsService.delete(SETTING_KEYS.DISCORD_CLIENT_ID),
      this.settingsService.delete(SETTING_KEYS.DISCORD_CLIENT_SECRET),
      this.settingsService.delete(SETTING_KEYS.DISCORD_CALLBACK_URL),
    ]);

    this.logger.log('Discord OAuth configuration cleared via admin UI');

    return {
      success: true,
      message: 'Discord OAuth configuration cleared.',
    };
  }

  // ============================================================
  // IGDB Configuration (ROK-229)
  // ============================================================

  /**
   * GET /admin/settings/igdb
   * Returns current IGDB configuration status.
   */
  @Get('igdb')
  async getIgdbStatus(): Promise<IgdbStatusResponse> {
    const configured = await this.settingsService.isIgdbConfigured();
    const health = configured ? this.igdbService.getHealthStatus() : undefined;
    return { configured, health };
  }

  /**
   * PUT /admin/settings/igdb
   * Update IGDB credentials.
   */
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

  /**
   * POST /admin/settings/igdb/test
   * Test IGDB credentials by fetching a real Twitch OAuth token.
   */
  @Post('igdb/test')
  @HttpCode(HttpStatus.OK)
  async testIgdbConfig(): Promise<OAuthTestResponse> {
    const config = await this.settingsService.getIgdbConfig();

    if (!config) {
      return {
        success: false,
        message: 'IGDB is not configured',
      };
    }

    try {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'client_credentials',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`IGDB test failed: ${response.status} ${errorText}`);
        return {
          success: false,
          message: 'Invalid Client ID or Client Secret',
        };
      }

      return {
        success: true,
        message: 'Credentials verified! IGDB / Twitch API is ready.',
      };
    } catch (error) {
      this.logger.error('Failed to test IGDB credentials:', error);
      return {
        success: false,
        message: 'Failed to connect to Twitch API. Please check your network.',
      };
    }
  }

  /**
   * POST /admin/settings/igdb/clear
   * Remove IGDB configuration.
   */
  @Post('igdb/clear')
  @HttpCode(HttpStatus.OK)
  async clearIgdbConfig(): Promise<{ success: boolean; message: string }> {
    await Promise.all([
      this.settingsService.delete(SETTING_KEYS.IGDB_CLIENT_ID),
      this.settingsService.delete(SETTING_KEYS.IGDB_CLIENT_SECRET),
    ]);

    // Emit event to clear cached token in IgdbService
    this.settingsService['eventEmitter'].emit('settings.igdb.updated', null);

    this.logger.log('IGDB configuration cleared via admin UI');

    return {
      success: true,
      message: 'IGDB configuration cleared.',
    };
  }

  // ============================================================
  // Blizzard API Configuration (ROK-234)
  // ============================================================

  /**
   * GET /admin/settings/blizzard
   * Returns current Blizzard API configuration status.
   */
  @Get('blizzard')
  async getBlizzardStatus(): Promise<BlizzardStatusResponse> {
    const configured = await this.settingsService.isBlizzardConfigured();
    return { configured };
  }

  /**
   * PUT /admin/settings/blizzard
   * Update Blizzard API credentials.
   */
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

  /**
   * POST /admin/settings/blizzard/test
   * Test Blizzard credentials by fetching a real OAuth token.
   */
  @Post('blizzard/test')
  @HttpCode(HttpStatus.OK)
  async testBlizzardConfig(): Promise<OAuthTestResponse> {
    const config = await this.settingsService.getBlizzardConfig();

    if (!config) {
      return {
        success: false,
        message: 'Blizzard API is not configured',
      };
    }

    try {
      const response = await fetch('https://us.battle.net/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(
          `Blizzard test failed: ${response.status} ${errorText}`,
        );
        return {
          success: false,
          message: 'Invalid Client ID or Client Secret',
        };
      }

      return {
        success: true,
        message: 'Credentials verified! Blizzard API is ready.',
      };
    } catch (error) {
      this.logger.error('Failed to test Blizzard credentials:', error);
      return {
        success: false,
        message:
          'Failed to connect to Blizzard API. Please check your network.',
      };
    }
  }

  /**
   * POST /admin/settings/blizzard/clear
   * Remove Blizzard API configuration.
   */
  @Post('blizzard/clear')
  @HttpCode(HttpStatus.OK)
  async clearBlizzardConfig(): Promise<{
    success: boolean;
    message: string;
  }> {
    await Promise.all([
      this.settingsService.delete(SETTING_KEYS.BLIZZARD_CLIENT_ID),
      this.settingsService.delete(SETTING_KEYS.BLIZZARD_CLIENT_SECRET),
    ]);

    this.settingsService['eventEmitter'].emit(
      'settings.blizzard.updated',
      null,
    );

    this.logger.log('Blizzard API configuration cleared via admin UI');

    return {
      success: true,
      message: 'Blizzard API configuration cleared.',
    };
  }

  // ============================================================
  // ROK-173: IGDB Sync & Game Library
  // ============================================================

  /**
   * GET /admin/settings/igdb/sync-status
   * Returns sync status (last sync time, game count, sync in progress).
   */
  @Get('igdb/sync-status')
  async getIgdbSyncStatus(): Promise<IgdbSyncStatusDto> {
    return this.igdbService.getSyncStatus();
  }

  /**
   * POST /admin/settings/igdb/sync
   * Trigger a manual IGDB sync.
   */
  @Post('igdb/sync')
  @HttpCode(HttpStatus.OK)
  async triggerIgdbSync(): Promise<{
    success: boolean;
    message: string;
    refreshed: number;
    discovered: number;
  }> {
    try {
      const result = await this.igdbService.syncAllGames();
      return {
        success: true,
        message: `Sync complete: ${result.refreshed} refreshed, ${result.discovered} discovered`,
        ...result,
      };
    } catch (error) {
      this.logger.error('Manual IGDB sync failed:', error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Sync failed unexpectedly',
        refreshed: 0,
        discovered: 0,
      };
    }
  }

  /**
   * GET /admin/settings/games
   * Paginated game library for admin management.
   */
  @Get('games')
  async listGames(
    @Query('search') search?: string,
    @Query('showHidden') showHidden?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ): Promise<AdminGameListResponseDto> {
    const db = this.igdbService.database;

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    const conditions = [];
    if (search) {
      conditions.push(
        ilike(schema.games.name, `%${search.replace(/[%_\\]/g, '\\$&')}%`),
      );
    }
    // When showHidden is 'only', show only hidden games
    // When showHidden is 'true', show all games (no hidden filter)
    // Otherwise, show only visible games
    if (showHidden === 'only') {
      conditions.push(eq(schema.games.hidden, true));
    } else if (showHidden !== 'true') {
      conditions.push(eq(schema.games.hidden, false));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.games)
        .where(whereClause),
      db
        .select({
          id: schema.games.id,
          igdbId: schema.games.igdbId,
          name: schema.games.name,
          slug: schema.games.slug,
          coverUrl: schema.games.coverUrl,
          cachedAt: schema.games.cachedAt,
          hidden: schema.games.hidden,
        })
        .from(schema.games)
        .where(whereClause)
        .orderBy(schema.games.name)
        .limit(safeLimit)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data: rows.map((r) => ({
        ...r,
        cachedAt: r.cachedAt.toISOString(),
      })),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
        hasMore: safePage * safeLimit < total,
      },
    };
  }

  /**
   * DELETE /admin/settings/games/:id
   * Remove a game from the local cache.
   */
  @Delete('games/:id')
  @HttpCode(HttpStatus.OK)
  async deleteGame(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: boolean; message: string }> {
    const db = this.igdbService.database;

    const existing = await db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new BadRequestException('Game not found');
    }

    await db.delete(schema.games).where(eq(schema.games.id, id));

    this.logger.log(
      `Game "${existing[0].name}" (id=${id}) deleted via admin UI`,
    );

    return {
      success: true,
      message: `Game "${existing[0].name}" removed from library.`,
    };
  }

  /**
   * POST /admin/settings/games/:id/hide
   * Hide a game from user-facing search/discovery.
   */
  @Post('games/:id/hide')
  @HttpCode(HttpStatus.OK)
  async hideGame(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.igdbService.hideGame(id);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }
    return { success: result.success, message: result.message };
  }

  /**
   * POST /admin/settings/games/:id/unhide
   * Unhide a previously hidden game.
   */
  @Post('games/:id/unhide')
  @HttpCode(HttpStatus.OK)
  async unhideGame(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.igdbService.unhideGame(id);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }
    return { success: result.success, message: result.message };
  }

  /**
   * GET /admin/settings/igdb/adult-filter
   * Get the current adult content filter status.
   */
  @Get('igdb/adult-filter')
  async getAdultFilter(): Promise<{ enabled: boolean }> {
    const enabled = await this.igdbService.isAdultFilterEnabled();
    return { enabled };
  }

  /**
   * PUT /admin/settings/igdb/adult-filter
   * Toggle the adult content filter.
   * When enabled, auto-hides existing games with adult themes.
   */
  @Put('igdb/adult-filter')
  @HttpCode(HttpStatus.OK)
  async setAdultFilter(
    @Body() body: { enabled: boolean },
  ): Promise<{ success: boolean; message: string; hiddenCount?: number }> {
    const enabled = body.enabled === true;

    await this.settingsService.set(
      SETTING_KEYS.IGDB_FILTER_ADULT,
      String(enabled),
    );

    let hiddenCount = 0;
    if (enabled) {
      // Auto-hide existing games with adult themes
      hiddenCount = await this.igdbService.hideAdultGames();
    }

    this.logger.log(
      `Adult content filter ${enabled ? 'enabled' : 'disabled'} via admin UI` +
        (hiddenCount > 0 ? ` (${hiddenCount} games auto-hidden)` : ''),
    );

    return {
      success: true,
      message: enabled
        ? `Adult content filter enabled.${hiddenCount > 0 ? ` ${hiddenCount} games with adult themes were hidden.` : ''}`
        : 'Adult content filter disabled.',
      hiddenCount: enabled ? hiddenCount : undefined,
    };
  }

  // ============================================================
  // ROK-193: Demo Data Management
  // ============================================================

  /**
   * GET /admin/settings/demo/status
   * Returns demo data entity counts and demoMode flag.
   */
  @Get('demo/status')
  async getDemoStatus(): Promise<DemoDataStatusDto> {
    return this.demoDataService.getStatus();
  }

  /**
   * POST /admin/settings/demo/install
   * Install all demo data (users, events, characters, etc.).
   */
  @Post('demo/install')
  @HttpCode(HttpStatus.OK)
  async installDemoData(): Promise<DemoDataResultDto> {
    return this.demoDataService.installDemoData();
  }

  /**
   * POST /admin/settings/demo/clear
   * Delete all demo data in FK-safe order.
   */
  @Post('demo/clear')
  @HttpCode(HttpStatus.OK)
  async clearDemoData(): Promise<DemoDataResultDto> {
    return this.demoDataService.clearDemoData();
  }

  // ============================================================
  // ROK-186: GitHub Feedback Integration
  // @deprecated ROK-306 — Replaced by Sentry error tracking.
  // These endpoints return deprecation notices; GitHub issue creation
  // is now handled automatically via Sentry alert rules.
  // ============================================================

  /**
   * @deprecated ROK-306 — GitHub PAT replaced by Sentry.
   */
  @Get('github')
  getGitHubStatus(): {
    configured: boolean;
    deprecated: boolean;
    message: string;
  } {
    return {
      configured: false,
      deprecated: true,
      message:
        'GitHub PAT integration has been replaced by Sentry error tracking (ROK-306).',
    };
  }

  /**
   * @deprecated ROK-306 — GitHub PAT no longer supported.
   */
  @Put('github')
  @HttpCode(HttpStatus.OK)
  updateGitHubConfig(): { success: boolean; message: string } {
    return {
      success: false,
      message:
        'GitHub PAT integration has been replaced by Sentry error tracking (ROK-306). No configuration needed.',
    };
  }

  /**
   * @deprecated ROK-306 — GitHub PAT test no longer supported.
   */
  @Post('github/test')
  @HttpCode(HttpStatus.OK)
  testGitHubConfig(): OAuthTestResponse {
    return {
      success: false,
      message:
        'GitHub PAT integration has been replaced by Sentry error tracking (ROK-306).',
    };
  }

  /**
   * @deprecated ROK-306 — GitHub PAT clear no longer needed.
   */
  @Post('github/clear')
  @HttpCode(HttpStatus.OK)
  async clearGitHubConfig(): Promise<{ success: boolean; message: string }> {
    // Still clear any existing PAT for cleanup purposes
    await this.settingsService.delete(SETTING_KEYS.GITHUB_PAT);
    return {
      success: true,
      message:
        'GitHub PAT cleared. Feedback is now handled by Sentry error tracking.',
    };
  }
}
