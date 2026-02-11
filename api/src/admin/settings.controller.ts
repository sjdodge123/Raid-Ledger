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
import {
  IgdbSyncStatusDto,
  IgdbHealthStatusDto,
  AdminGameListResponseDto,
} from '@raid-ledger/contract';
import { eq, ilike, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

export interface OAuthStatusResponse {
  configured: boolean;
  callbackUrl: string | null;
}

export interface IgdbStatusResponse {
  configured: boolean;
  health?: IgdbHealthStatusDto;
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
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ): Promise<AdminGameListResponseDto> {
    const db = this.igdbService.database;

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    const whereClause = search
      ? ilike(schema.games.name, `%${search.replace(/[%_\\]/g, '\\$&')}%`)
      : undefined;

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
}
