import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { appSettings, SETTING_KEYS, SettingKey } from '../drizzle/schema';
import { encrypt, decrypt } from './encryption.util';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export interface IgdbConfig {
  clientId: string;
  clientSecret: string;
}

export interface BlizzardConfig {
  clientId: string;
  clientSecret: string;
}

export interface BrandingConfig {
  communityName: string | null;
  communityLogoPath: string | null;
  communityAccentColor: string | null;
}

export interface DiscordBotConfig {
  token: string;
  enabled: boolean;
}

export const SETTINGS_EVENTS = {
  OAUTH_DISCORD_UPDATED: 'settings.oauth.discord.updated',
  IGDB_UPDATED: 'settings.igdb.updated',
  BLIZZARD_UPDATED: 'settings.blizzard.updated',
  DEMO_MODE_UPDATED: 'settings.demo_mode.updated',
  DISCORD_BOT_UPDATED: 'settings.discord-bot.updated',
} as const;

/** How long the in-memory cache is considered fresh (ms). */
const CACHE_TTL_MS = 60_000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  /** In-memory cache: setting key -> decrypted value. */
  private cache = new Map<string, string>();

  /** Timestamp (epoch ms) when the cache was last loaded from DB. */
  private cacheLoadedAt = 0;

  /** Prevents concurrent cache loads from racing. */
  private cacheLoadPromise: Promise<void> | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Load all settings into the in-memory cache if stale or empty.
   * Coalesces concurrent callers so only one DB round-trip occurs.
   */
  private async ensureCache(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) return;

    if (!this.cacheLoadPromise) {
      this.cacheLoadPromise = this.loadCache();
    }
    await this.cacheLoadPromise;
  }

  private async loadCache(): Promise<void> {
    try {
      const rows = await this.db.select().from(appSettings);
      const fresh = new Map<string, string>();

      for (const row of rows) {
        try {
          fresh.set(row.key, decrypt(row.encryptedValue));
        } catch {
          this.logger.error(
            `Failed to decrypt setting ${row.key} during cache load`,
          );
        }
      }

      this.cache = fresh;
      this.cacheLoadedAt = Date.now();
      this.logger.debug(`Settings cache loaded (${fresh.size} entries)`);
    } finally {
      this.cacheLoadPromise = null;
    }
  }

  /**
   * Get a setting value by key (decrypted).
   * Served from in-memory cache; falls back to DB only on cache miss after load.
   */
  async get(key: SettingKey): Promise<string | null> {
    await this.ensureCache();
    return this.cache.get(key) ?? null;
  }

  /**
   * Set a setting value (encrypted).
   * Writes through to DB and updates the in-memory cache immediately.
   */
  async set(key: SettingKey, value: string): Promise<void> {
    const encryptedValue = encrypt(value);

    await this.db
      .insert(appSettings)
      .values({
        key,
        encryptedValue,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          encryptedValue,
          updatedAt: new Date(),
        },
      });

    this.cache.set(key, value);
    this.logger.debug(`Setting ${key} updated`);
  }

  /**
   * Delete a setting.
   * Removes from both DB and the in-memory cache.
   */
  async delete(key: SettingKey): Promise<void> {
    await this.db.delete(appSettings).where(eq(appSettings.key, key));
    this.cache.delete(key);
    this.logger.debug(`Setting ${key} deleted`);
  }

  /**
   * Check if a setting exists.
   * Served from in-memory cache.
   */
  async exists(key: SettingKey): Promise<boolean> {
    await this.ensureCache();
    return this.cache.has(key);
  }

  /**
   * Get Discord OAuth configuration
   */
  async getDiscordOAuthConfig(): Promise<DiscordOAuthConfig | null> {
    const [clientId, clientSecret, callbackUrl] = await Promise.all([
      this.get(SETTING_KEYS.DISCORD_CLIENT_ID),
      this.get(SETTING_KEYS.DISCORD_CLIENT_SECRET),
      this.get(SETTING_KEYS.DISCORD_CALLBACK_URL),
    ]);

    if (!clientId || !clientSecret) {
      return null;
    }

    return {
      clientId,
      clientSecret,
      callbackUrl: callbackUrl || 'http://localhost:3000/auth/discord/callback',
    };
  }

  /**
   * Set Discord OAuth configuration
   */
  async setDiscordOAuthConfig(config: DiscordOAuthConfig): Promise<void> {
    await Promise.all([
      this.set(SETTING_KEYS.DISCORD_CLIENT_ID, config.clientId),
      this.set(SETTING_KEYS.DISCORD_CLIENT_SECRET, config.clientSecret),
      this.set(SETTING_KEYS.DISCORD_CALLBACK_URL, config.callbackUrl),
    ]);

    // Emit event for hot reload
    this.eventEmitter.emit(SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED, config);
    this.logger.log(
      'Discord OAuth configuration updated, emitting reload event',
    );
  }

  /**
   * Check if Discord OAuth is configured
   */
  async isDiscordConfigured(): Promise<boolean> {
    const [clientIdExists, clientSecretExists] = await Promise.all([
      this.exists(SETTING_KEYS.DISCORD_CLIENT_ID),
      this.exists(SETTING_KEYS.DISCORD_CLIENT_SECRET),
    ]);

    return clientIdExists && clientSecretExists;
  }

  /**
   * Get demo mode status
   */
  async getDemoMode(): Promise<boolean> {
    const value = await this.get(SETTING_KEYS.DEMO_MODE);
    return value === 'true';
  }

  /**
   * Set demo mode status
   */
  async setDemoMode(enabled: boolean): Promise<void> {
    await this.set(SETTING_KEYS.DEMO_MODE, enabled ? 'true' : 'false');
    this.eventEmitter.emit(SETTINGS_EVENTS.DEMO_MODE_UPDATED, enabled);
    this.logger.log(`Demo mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get IGDB configuration
   */
  async getIgdbConfig(): Promise<IgdbConfig | null> {
    const [clientId, clientSecret] = await Promise.all([
      this.get(SETTING_KEYS.IGDB_CLIENT_ID),
      this.get(SETTING_KEYS.IGDB_CLIENT_SECRET),
    ]);

    if (!clientId || !clientSecret) {
      return null;
    }

    return { clientId, clientSecret };
  }

  /**
   * Set IGDB configuration
   */
  async setIgdbConfig(config: IgdbConfig): Promise<void> {
    await Promise.all([
      this.set(SETTING_KEYS.IGDB_CLIENT_ID, config.clientId),
      this.set(SETTING_KEYS.IGDB_CLIENT_SECRET, config.clientSecret),
    ]);

    this.eventEmitter.emit(SETTINGS_EVENTS.IGDB_UPDATED, config);
    this.logger.log('IGDB configuration updated, emitting reload event');
  }

  /**
   * Check if IGDB is configured
   */
  async isIgdbConfigured(): Promise<boolean> {
    const [clientIdExists, clientSecretExists] = await Promise.all([
      this.exists(SETTING_KEYS.IGDB_CLIENT_ID),
      this.exists(SETTING_KEYS.IGDB_CLIENT_SECRET),
    ]);

    return clientIdExists && clientSecretExists;
  }

  /**
   * Get Blizzard API configuration (ROK-234)
   */
  async getBlizzardConfig(): Promise<BlizzardConfig | null> {
    const [clientId, clientSecret] = await Promise.all([
      this.get(SETTING_KEYS.BLIZZARD_CLIENT_ID),
      this.get(SETTING_KEYS.BLIZZARD_CLIENT_SECRET),
    ]);

    if (!clientId || !clientSecret) {
      return null;
    }

    return { clientId, clientSecret };
  }

  /**
   * Set Blizzard API configuration (ROK-234)
   */
  async setBlizzardConfig(config: BlizzardConfig): Promise<void> {
    await Promise.all([
      this.set(SETTING_KEYS.BLIZZARD_CLIENT_ID, config.clientId),
      this.set(SETTING_KEYS.BLIZZARD_CLIENT_SECRET, config.clientSecret),
    ]);

    this.eventEmitter.emit(SETTINGS_EVENTS.BLIZZARD_UPDATED, config);
    this.logger.log(
      'Blizzard API configuration updated, emitting reload event',
    );
  }

  /**
   * Check if Blizzard API is configured (ROK-234)
   */
  async isBlizzardConfigured(): Promise<boolean> {
    const [clientIdExists, clientSecretExists] = await Promise.all([
      this.exists(SETTING_KEYS.BLIZZARD_CLIENT_ID),
      this.exists(SETTING_KEYS.BLIZZARD_CLIENT_SECRET),
    ]);

    return clientIdExists && clientSecretExists;
  }

  /**
   * Get community branding settings (ROK-271)
   */
  async getBranding(): Promise<BrandingConfig> {
    const [name, logoPath, accentColor] = await Promise.all([
      this.get(SETTING_KEYS.COMMUNITY_NAME),
      this.get(SETTING_KEYS.COMMUNITY_LOGO_PATH),
      this.get(SETTING_KEYS.COMMUNITY_ACCENT_COLOR),
    ]);

    return {
      communityName: name,
      communityLogoPath: logoPath,
      communityAccentColor: accentColor,
    };
  }

  /**
   * Set community display name (ROK-271)
   */
  async setCommunityName(name: string): Promise<void> {
    await this.set(SETTING_KEYS.COMMUNITY_NAME, name);
    this.logger.log('Community name updated');
  }

  /**
   * Set community logo file path (ROK-271)
   */
  async setCommunityLogoPath(filePath: string): Promise<void> {
    await this.set(SETTING_KEYS.COMMUNITY_LOGO_PATH, filePath);
    this.logger.log('Community logo path updated');
  }

  /**
   * Set community accent color (ROK-271)
   */
  async setCommunityAccentColor(color: string): Promise<void> {
    await this.set(SETTING_KEYS.COMMUNITY_ACCENT_COLOR, color);
    this.logger.log('Community accent color updated');
  }

  /**
   * Clear all branding settings (ROK-271)
   */
  async clearBranding(): Promise<void> {
    await Promise.all([
      this.delete(SETTING_KEYS.COMMUNITY_NAME),
      this.delete(SETTING_KEYS.COMMUNITY_LOGO_PATH),
      this.delete(SETTING_KEYS.COMMUNITY_ACCENT_COLOR),
    ]);
    this.logger.log('Community branding reset to defaults');
  }

  /**
   * Get GitHub PAT for feedback issue creation (ROK-186)
   */
  async getGitHubPat(): Promise<string | null> {
    return this.get(SETTING_KEYS.GITHUB_PAT);
  }

  /**
   * Set GitHub PAT (ROK-186)
   */
  async setGitHubPat(token: string): Promise<void> {
    await this.set(SETTING_KEYS.GITHUB_PAT, token);
    this.logger.log('GitHub PAT updated');
  }

  /**
   * Check if GitHub PAT is configured (ROK-186)
   */
  async isGitHubConfigured(): Promise<boolean> {
    return this.exists(SETTING_KEYS.GITHUB_PAT);
  }

  /**
   * Get Discord bot configuration (ROK-117)
   */
  async getDiscordBotConfig(): Promise<DiscordBotConfig | null> {
    const token = await this.get(SETTING_KEYS.DISCORD_BOT_TOKEN);
    if (!token) return null;

    const enabledVal = await this.get(SETTING_KEYS.DISCORD_BOT_ENABLED);
    return { token, enabled: enabledVal === 'true' };
  }

  /**
   * Set Discord bot configuration (ROK-117)
   */
  async setDiscordBotConfig(token: string, enabled: boolean): Promise<void> {
    await Promise.all([
      this.set(SETTING_KEYS.DISCORD_BOT_TOKEN, token),
      this.set(SETTING_KEYS.DISCORD_BOT_ENABLED, enabled ? 'true' : 'false'),
    ]);

    // Use emitAsync to properly dispatch to async @OnEvent handlers.
    // Fire-and-forget: the bot connection happens in the background so we
    // don't block the HTTP response.  Errors are logged, not re-thrown.
    this.eventEmitter
      .emitAsync(SETTINGS_EVENTS.DISCORD_BOT_UPDATED, { token, enabled })
      .catch((error: unknown) => {
        this.logger.error('Error in DISCORD_BOT_UPDATED event handler:', error);
      });

    this.logger.log('Discord bot configuration updated');
  }

  /**
   * Check if Discord bot is configured (ROK-117)
   */
  async isDiscordBotConfigured(): Promise<boolean> {
    return this.exists(SETTING_KEYS.DISCORD_BOT_TOKEN);
  }

  /**
   * Clear Discord bot configuration (ROK-117)
   */
  async clearDiscordBotConfig(): Promise<void> {
    await Promise.all([
      this.delete(SETTING_KEYS.DISCORD_BOT_TOKEN),
      this.delete(SETTING_KEYS.DISCORD_BOT_ENABLED),
    ]);

    this.eventEmitter
      .emitAsync(SETTINGS_EVENTS.DISCORD_BOT_UPDATED, null)
      .catch((error: unknown) => {
        this.logger.error(
          'Error in DISCORD_BOT_UPDATED event handler (clear):',
          error,
        );
      });
    this.logger.log('Discord bot configuration cleared');
  }

  /**
   * Get Discord bot default channel ID (ROK-118)
   */
  async getDiscordBotDefaultChannel(): Promise<string | null> {
    return this.get(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL);
  }

  /**
   * Set Discord bot default channel ID (ROK-118)
   */
  async setDiscordBotDefaultChannel(channelId: string): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL, channelId);
    this.logger.log('Discord bot default channel updated');
  }

  /**
   * Check if the Discord bot setup wizard has been completed (ROK-349)
   */
  async isDiscordBotSetupCompleted(): Promise<boolean> {
    const value = await this.get(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED);
    return value === 'true';
  }

  /**
   * Mark setup wizard as completed (ROK-349)
   */
  async markDiscordBotSetupCompleted(): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED, 'true');
    this.logger.log('Discord bot setup wizard marked as completed');
  }

  /**
   * Get the Discord bot community name override (ROK-349)
   */
  async getDiscordBotCommunityName(): Promise<string | null> {
    return this.get(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME);
  }

  /**
   * Set the Discord bot community name override (ROK-349)
   */
  async setDiscordBotCommunityName(name: string): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME, name);
    this.logger.log('Discord bot community name updated');
  }

  /**
   * Get the Discord bot timezone setting (ROK-349)
   */
  async getDiscordBotTimezone(): Promise<string | null> {
    return this.get(SETTING_KEYS.DISCORD_BOT_TIMEZONE);
  }

  /**
   * Set the Discord bot timezone setting (ROK-349)
   */
  async setDiscordBotTimezone(timezone: string): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_TIMEZONE, timezone);
    this.logger.log('Discord bot timezone updated');
  }

  /**
   * Get the client URL with fallback chain (ROK-408):
   * 1. Explicit app_settings override (client_url)
   * 2. Derived from Discord callback URL origin
   * 3. Legacy process.env.CLIENT_URL
   * 4. null
   */
  async getClientUrl(): Promise<string | null> {
    const explicit = await this.get(SETTING_KEYS.CLIENT_URL);
    if (explicit) return explicit;

    const callbackUrl = await this.get(SETTING_KEYS.DISCORD_CALLBACK_URL);
    if (callbackUrl) {
      try {
        return new URL(callbackUrl).origin;
      } catch {
        /* invalid URL — fall through */
      }
    }

    return process.env.CLIENT_URL ?? null;
  }
}
