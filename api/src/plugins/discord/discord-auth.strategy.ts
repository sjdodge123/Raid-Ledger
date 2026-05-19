import passport from 'passport';
import { Strategy as DiscordStrategy, Profile } from 'passport-discord';
import type { VerifyCallback } from 'passport-oauth2';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { bestEffortInit } from '../../common/lifecycle.util';
import { OnEvent } from '@nestjs/event-emitter';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { SettingsService } from '../../settings/settings.service';
import { SETTINGS_EVENTS } from '../../settings/settings.types';
import type { DiscordOAuthConfig } from '../../settings/settings.types';

/**
 * Dynamic Discord OAuth strategy that supports hot-reload.
 * Configuration is loaded from database (via SettingsService) instead of env vars,
 * allowing admins to update OAuth credentials without container restarts.
 */
@Injectable()
export class DiscordAuthStrategy
  extends PassportStrategy(DiscordStrategy, 'discord')
  implements OnModuleInit
{
  private readonly logger = new Logger(DiscordAuthStrategy.name);
  private isStrategyConfigured = false;
  private latestConfig: DiscordOAuthConfig | null = null;

  constructor(
    private authService: AuthService,
    private settingsService: SettingsService,
  ) {
    // Placeholder config — overwritten on first reloadConfig().
    // DI requires super() to run so the NestJS class can be constructed.
    super({
      clientID: 'placeholder',
      clientSecret: 'placeholder',
      callbackURL: 'http://localhost:3000/auth/discord/callback',
      scope: ['identify'],
    });
  }

  async onModuleInit(): Promise<void> {
    await bestEffortInit('DiscordAuthStrategy', this.logger, () =>
      this.reloadConfig(),
    );
  }

  /**
   * Reload OAuth configuration from database. Re-registers a fresh bare
   * passport-discord Strategy under the 'discord' name so the constructor —
   * not post-construction mutation — installs the current callbackURL.
   */
  async reloadConfig(): Promise<void> {
    try {
      const config = await this.settingsService.getDiscordOAuthConfig();
      if (!config) {
        this.logger.warn('Discord OAuth not configured - strategy disabled');
        this.isStrategyConfigured = false;
        this.latestConfig = null;
        return;
      }
      passport.use('discord', this.buildBareStrategy(config));
      this.latestConfig = config;
      this.isStrategyConfigured = true;
      this.logger.log('Discord OAuth strategy reloaded with new configuration');
    } catch (error) {
      this.logger.error('Failed to reload Discord OAuth config:', error);
      this.isStrategyConfigured = false;
    }
  }

  private buildBareStrategy(config: DiscordOAuthConfig): DiscordStrategy {
    return new DiscordStrategy(
      {
        clientID: config.clientId,
        clientSecret: config.clientSecret,
        callbackURL: config.callbackUrl,
        scope: ['identify'],
      },
      (accessToken, refreshToken, profile, done) => {
        void this.verifyDiscordProfile(
          accessToken,
          refreshToken,
          profile,
          done,
        );
      },
    );
  }

  /**
   * Handle settings update event for hot-reload.
   */
  @OnEvent(SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED)
  async handleOAuthUpdate() {
    this.logger.log('Discord OAuth settings updated, reloading strategy...');
    await this.reloadConfig();
  }

  /**
   * Check if the strategy is currently configured and usable.
   */
  isEnabled(): boolean {
    return this.isStrategyConfigured;
  }

  /**
   * Override authenticate to inject the freshest callbackURL per request.
   * `passport-oauth2` honors `options.callbackURL` over its cached
   * `this._callbackURL`, so this is the load-bearing override even if the
   * registered strategy somehow drifts.
   */
  authenticate(req: Request, options?: object): void {
    if (this.isStrategyConfigured && this.latestConfig?.callbackUrl) {
      super.authenticate(req, {
        ...(options ?? {}),
        callbackURL: this.latestConfig.callbackUrl,
      });
      return;
    }
    super.authenticate(req, options);
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
  ): Promise<{ id: number; username: string; role: string }> {
    if (!this.isStrategyConfigured) {
      throw new Error('Discord OAuth is not configured');
    }
    const user = await this.runValidate(profile);
    if (!user) {
      throw new Error('Failed to validate Discord user');
    }
    return user;
  }

  /**
   * Shared verify path used by both the NestJS-wrapped `validate()` and the
   * bare Strategy registered in `reloadConfig`. Routes through
   * `authService.validateDiscordUser` and calls back with the appropriate
   * error/user shape passport-oauth2 expects.
   */
  private async verifyDiscordProfile(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const user = await this.runValidate(profile);
      if (!user) {
        done(new Error('Failed to validate Discord user'));
        return;
      }
      done(null, user);
    } catch (err) {
      done(err);
    }
  }

  private async runValidate(profile: Profile) {
    const { id, username, avatar } = profile;
    return this.authService.validateDiscordUser(
      id,
      username,
      avatar ?? undefined,
    );
  }
}
