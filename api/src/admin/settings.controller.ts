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

export class OAuthConfigDto {
    @IsString()
    @IsNotEmpty({ message: 'Client ID is required' })
    clientId!: string;

    @IsString()
    @IsNotEmpty({ message: 'Client Secret is required' })
    clientSecret!: string;

    @IsOptional()
    @IsUrl({ require_tld: false }, { message: 'Callback URL must be a valid URL' })
    callbackUrl?: string;
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

    constructor(private readonly settingsService: SettingsService) { }

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
            message: 'Discord OAuth configuration saved. Discord login is now enabled.',
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

        try {
            // Make a test request to Discord's token endpoint
            // We use a grant_type that will fail, but will tell us if credentials are valid
            const response = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    grant_type: 'client_credentials',
                    scope: 'identify',
                }),
            });

            // Discord returns 400 for invalid grant type but with proper error codes
            const data = await response.json();

            if (response.status === 401) {
                return {
                    success: false,
                    message: 'Invalid Client ID or Client Secret',
                };
            }

            // Even if grant type fails, if we get a proper response, credentials are valid
            if (response.status === 400 && data.error === 'unsupported_grant_type') {
                return {
                    success: true,
                    message: 'Credentials are valid! Discord OAuth is ready to use.',
                };
            }

            if (data.error === 'invalid_client') {
                return {
                    success: false,
                    message: 'Invalid Client ID or Client Secret',
                };
            }

            // Successful token response (unlikely for bots)
            return {
                success: true,
                message: 'Credentials verified successfully!',
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
}
