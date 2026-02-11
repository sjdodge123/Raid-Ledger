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
} from '@nestjs/common';
import { IsNotEmpty, IsString, IsUrl, IsOptional } from 'class-validator';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

export interface OAuthStatusResponse {
  configured: boolean;
  callbackUrl: string | null;
}

export interface IgdbStatusResponse {
  configured: boolean;
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

  constructor(private readonly settingsService: SettingsService) {}

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
          return { success: true, message: 'Credentials verified successfully!' };
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
    return { configured };
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
}
