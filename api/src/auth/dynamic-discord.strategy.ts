import { Strategy, Profile } from 'passport-discord';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthService } from './auth.service';
import { SettingsService, SETTINGS_EVENTS } from '../settings/settings.service';
import type { DiscordOAuthConfig } from '../settings/settings.service';

/**
 * Dynamic Discord OAuth strategy that supports hot-reload.
 * Configuration is loaded from database (via SettingsService) instead of env vars,
 * allowing admins to update OAuth credentials without container restarts.
 */
@Injectable()
export class DynamicDiscordStrategy
    extends PassportStrategy(Strategy, 'discord')
    implements OnModuleInit {
    private readonly logger = new Logger(DynamicDiscordStrategy.name);
    private isConfigured = false;

    constructor(
        private authService: AuthService,
        private settingsService: SettingsService,
    ) {
        // Initialize with placeholder config - will be updated in onModuleInit
        super({
            clientID: 'placeholder',
            clientSecret: 'placeholder',
            callbackURL: 'http://localhost:3000/auth/discord/callback',
            scope: ['identify'],
        });
    }

    async onModuleInit() {
        await this.reloadConfig();
    }

    /**
     * Reload OAuth configuration from database.
     * Called on startup and when settings are updated.
     */
    async reloadConfig(): Promise<boolean> {
        try {
            const config = await this.settingsService.getDiscordOAuthConfig();

            if (!config) {
                this.logger.warn('Discord OAuth not configured - strategy disabled');
                this.isConfigured = false;
                return false;
            }

            // Update the passport strategy options
            this.updateStrategyOptions(config);
            this.isConfigured = true;
            this.logger.log('Discord OAuth strategy reloaded with new configuration');
            return true;
        } catch (error) {
            this.logger.error('Failed to reload Discord OAuth config:', error);
            this.isConfigured = false;
            return false;
        }
    }

    /**
     * Update passport strategy options dynamically.
     * This is a workaround since passport doesn't officially support hot-reload.
     * We update the internal OAuth2 client directly since the strategy is already registered.
     */
    private updateStrategyOptions(config: DiscordOAuthConfig): void {
        // Access the internal strategy and update its options
        const strategy = this as unknown as { _oauth2: any; _callbackURL: string };

        if (strategy._oauth2) {
            strategy._oauth2._clientId = config.clientId;
            strategy._oauth2._clientSecret = config.clientSecret;
        }

        strategy._callbackURL = config.callbackUrl;
        // Note: Strategy is already registered with passport by @nestjs/passport
        // No need to call passport.use() again
    }

    /**
     * Handle settings update event for hot-reload.
     */
    @OnEvent(SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED)
    async handleOAuthUpdate(_config: DiscordOAuthConfig) {
        this.logger.log('Discord OAuth settings updated, reloading strategy...');
        await this.reloadConfig();
    }

    /**
     * Check if the strategy is currently configured and usable.
     */
    isEnabled(): boolean {
        return this.isConfigured;
    }

    async validate(
        accessToken: string,
        refreshToken: string,
        profile: Profile,
    ): Promise<any> {
        if (!this.isConfigured) {
            throw new Error('Discord OAuth is not configured');
        }

        const { id, username, avatar } = profile;
        const user = await this.authService.validateDiscordUser(id, username, avatar ?? undefined);
        return user;
    }
}
