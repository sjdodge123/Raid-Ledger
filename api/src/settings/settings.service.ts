import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { appSettings, SETTING_KEYS, SettingKey } from '../drizzle/schema';
import { encrypt, decrypt } from './encryption.util';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import {
  emitBotReconnect,
  emitOAuthReconnect,
  emitIgdbReconnect,
  emitBlizzardReconnect,
} from './settings-reconnect.helpers';
import {
  getDiscordBotConfig as _getDiscordBotConfig,
  getClientUrl as _getClientUrl,
  getAutoExtendIncrement,
  getAutoExtendMaxOverage,
  getAutoExtendMinVoice,
  getDiscordOAuthConfig as _getDiscordOAuthConfig,
  getIgdbConfig as _getIgdbConfig,
  getBlizzardConfig as _getBlizzardConfig,
  getBranding as _getBranding,
  clearBranding as _clearBranding,
  setDiscordOAuthKeys,
  setIgdbKeys,
  setBlizzardKeys,
  setDiscordBotKeys,
  clearDiscordBotKeys,
  bothExist,
} from './settings-bot.helpers';

import { SETTINGS_EVENTS } from './settings.types';
import type {
  DiscordOAuthConfig,
  IgdbConfig,
  BlizzardConfig,
  BrandingConfig,
  DiscordBotConfig,
} from './settings.types';

const CACHE_TTL_MS = 5 * 60_000;

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, string>();
  private cacheLoadedAt = 0;
  private cacheLoadPromise: Promise<void> | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadCache();
  }

  /**
   * Ensures the settings cache is available. On cold start (cache never loaded),
   * blocks until the cache is populated. On warm cache with expired TTL,
   * serves stale data and triggers a non-blocking background refresh.
   */
  private async ensureCache(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) return;
    const isColdCache = this.cacheLoadedAt === 0;
    if (!this.cacheLoadPromise) {
      this.cacheLoadPromise = this.loadCache();
    }
    if (isColdCache) {
      await this.cacheLoadPromise;
    }
  }

  /** Loads all settings from DB, decrypts, and replaces the cache. */
  private async loadCache(): Promise<void> {
    try {
      const rows = await this.db.select().from(appSettings);
      const fresh = new Map<string, string>();
      for (const row of rows) {
        try {
          fresh.set(row.key, decrypt(row.encryptedValue));
        } catch {
          this.logger.error(`Failed to decrypt setting ${row.key}`);
        }
      }
      this.cache = fresh;
      this.cacheLoadedAt = Date.now();
      this.logger.debug(`Settings cache loaded (${fresh.size} entries)`);
    } catch (err: unknown) {
      this.logger.error('Background cache refresh failed', err);
    } finally {
      this.cacheLoadPromise = null;
    }
  }

  /** Get a setting value by key (decrypted, from cache). */
  async get(key: SettingKey): Promise<string | null> {
    await this.ensureCache();
    return this.cache.get(key) ?? null;
  }

  /** Set a setting value (encrypted, write-through to cache). */
  async set(key: SettingKey, value: string): Promise<void> {
    const encryptedValue = encrypt(value);
    await this.db
      .insert(appSettings)
      .values({ key, encryptedValue, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { encryptedValue, updatedAt: new Date() },
      });
    this.cache.set(key, value);
    this.cacheLoadedAt = Date.now();
  }

  /** Delete a setting from DB and cache. */
  async delete(key: SettingKey): Promise<void> {
    await this.db.delete(appSettings).where(eq(appSettings.key, key));
    this.cache.delete(key);
    this.cacheLoadedAt = Date.now();
  }

  /** Check if a setting exists (from cache). */
  async exists(key: SettingKey): Promise<boolean> {
    await this.ensureCache();
    return this.cache.has(key);
  }

  /** Force-reload cache on next access. */
  invalidateCache(): void {
    this.cacheLoadedAt = 0;
  }

  /** Emit cleared events for all integrations. */
  emitAllIntegrationsCleared(): void {
    this.eventEmitter.emit(SETTINGS_EVENTS.DISCORD_BOT_UPDATED, null);
    this.eventEmitter.emit(SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED, null);
    this.eventEmitter.emit(SETTINGS_EVENTS.IGDB_UPDATED, null);
    this.eventEmitter.emit(SETTINGS_EVENTS.BLIZZARD_UPDATED, null);
    this.eventEmitter.emit(SETTINGS_EVENTS.STEAM_UPDATED, null);
  }

  /** Reload cache and re-emit events so live services reconnect. */
  async reloadAndReconnectIntegrations(): Promise<void> {
    this.cacheLoadedAt = 0;
    await this.ensureCache();
    emitBotReconnect(this.cache, this.eventEmitter);
    emitOAuthReconnect(this.cache, this.eventEmitter);
    emitIgdbReconnect(this.cache, this.eventEmitter);
    emitBlizzardReconnect(this.cache, this.eventEmitter);
    this.logger.log('Integration reconnect events emitted');
  }

  // ─── Discord OAuth ────────────────────────────────────────────

  async getDiscordOAuthConfig(): Promise<DiscordOAuthConfig | null> {
    return _getDiscordOAuthConfig(this);
  }

  async setDiscordOAuthConfig(config: DiscordOAuthConfig): Promise<void> {
    await setDiscordOAuthKeys(this, config);
    this.eventEmitter.emit(SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED, config);
  }

  async isDiscordConfigured(): Promise<boolean> {
    return bothExist(
      this,
      SETTING_KEYS.DISCORD_CLIENT_ID,
      SETTING_KEYS.DISCORD_CLIENT_SECRET,
    );
  }

  // ─── Demo mode ────────────────────────────────────────────────

  async getDemoMode(): Promise<boolean> {
    return (await this.get(SETTING_KEYS.DEMO_MODE)) === 'true';
  }

  async setDemoMode(enabled: boolean): Promise<void> {
    await this.set(SETTING_KEYS.DEMO_MODE, enabled ? 'true' : 'false');
    this.eventEmitter.emit(SETTINGS_EVENTS.DEMO_MODE_UPDATED, enabled);
  }

  // ─── IGDB ─────────────────────────────────────────────────────

  async getIgdbConfig(): Promise<IgdbConfig | null> {
    return _getIgdbConfig(this);
  }

  async setIgdbConfig(config: IgdbConfig): Promise<void> {
    await setIgdbKeys(this, config);
    this.eventEmitter.emit(SETTINGS_EVENTS.IGDB_UPDATED, config);
  }

  async isIgdbConfigured(): Promise<boolean> {
    return bothExist(
      this,
      SETTING_KEYS.IGDB_CLIENT_ID,
      SETTING_KEYS.IGDB_CLIENT_SECRET,
    );
  }

  // ─── Blizzard ─────────────────────────────────────────────────

  async getBlizzardConfig(): Promise<BlizzardConfig | null> {
    return _getBlizzardConfig(this);
  }

  async setBlizzardConfig(config: BlizzardConfig): Promise<void> {
    await setBlizzardKeys(this, config);
    this.eventEmitter.emit(SETTINGS_EVENTS.BLIZZARD_UPDATED, config);
  }

  async isBlizzardConfigured(): Promise<boolean> {
    return bothExist(
      this,
      SETTING_KEYS.BLIZZARD_CLIENT_ID,
      SETTING_KEYS.BLIZZARD_CLIENT_SECRET,
    );
  }

  // ─── Branding ─────────────────────────────────────────────────

  async getBranding(): Promise<BrandingConfig> {
    return _getBranding(this);
  }

  async setCommunityName(name: string): Promise<void> {
    await this.set(SETTING_KEYS.COMMUNITY_NAME, name);
  }

  async setCommunityLogoPath(filePath: string): Promise<void> {
    await this.set(SETTING_KEYS.COMMUNITY_LOGO_PATH, filePath);
  }

  async setCommunityAccentColor(color: string): Promise<void> {
    await this.set(SETTING_KEYS.COMMUNITY_ACCENT_COLOR, color);
  }

  async clearBranding(): Promise<void> {
    await _clearBranding(this);
  }

  // ─── GitHub ───────────────────────────────────────────────────

  async getGitHubPat(): Promise<string | null> {
    return this.get(SETTING_KEYS.GITHUB_PAT);
  }

  async setGitHubPat(token: string): Promise<void> {
    await this.set(SETTING_KEYS.GITHUB_PAT, token);
  }

  async isGitHubConfigured(): Promise<boolean> {
    return this.exists(SETTING_KEYS.GITHUB_PAT);
  }

  // ─── Discord bot ──────────────────────────────────────────────

  async getDiscordBotConfig(): Promise<DiscordBotConfig | null> {
    return _getDiscordBotConfig(this);
  }

  async setDiscordBotConfig(token: string, enabled: boolean): Promise<void> {
    await setDiscordBotKeys(this, token, enabled);
    this.eventEmitter
      .emitAsync(SETTINGS_EVENTS.DISCORD_BOT_UPDATED, { token, enabled })
      .catch((err: unknown) => this.logger.error('Bot update error:', err));
  }

  async isDiscordBotConfigured(): Promise<boolean> {
    return this.exists(SETTING_KEYS.DISCORD_BOT_TOKEN);
  }

  async clearDiscordBotConfig(): Promise<void> {
    await clearDiscordBotKeys(this);
    this.eventEmitter
      .emitAsync(SETTINGS_EVENTS.DISCORD_BOT_UPDATED, null)
      .catch((err: unknown) => this.logger.error('Bot clear error:', err));
  }

  async getDiscordBotDefaultChannel(): Promise<string | null> {
    return this.get(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL);
  }

  async setDiscordBotDefaultChannel(channelId: string): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL, channelId);
  }

  async isDiscordBotSetupCompleted(): Promise<boolean> {
    return (
      (await this.get(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED)) === 'true'
    );
  }

  async markDiscordBotSetupCompleted(): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED, 'true');
  }

  async getDiscordBotCommunityName(): Promise<string | null> {
    return this.get(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME);
  }

  async setDiscordBotCommunityName(name: string): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME, name);
  }

  async getDiscordBotTimezone(): Promise<string | null> {
    return this.get(SETTING_KEYS.DISCORD_BOT_TIMEZONE);
  }

  async setDiscordBotTimezone(timezone: string): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_TIMEZONE, timezone);
  }

  async getDefaultTimezone(): Promise<string | null> {
    return this.get(SETTING_KEYS.DEFAULT_TIMEZONE);
  }

  async setDefaultTimezone(timezone: string): Promise<void> {
    await this.set(SETTING_KEYS.DEFAULT_TIMEZONE, timezone);
  }

  async getClientUrl(): Promise<string | null> {
    return _getClientUrl(this);
  }

  async getDiscordBotDefaultVoiceChannel(): Promise<string | null> {
    return this.get(SETTING_KEYS.DISCORD_BOT_DEFAULT_VOICE_CHANNEL);
  }

  async setDiscordBotDefaultVoiceChannel(channelId: string): Promise<void> {
    await this.set(SETTING_KEYS.DISCORD_BOT_DEFAULT_VOICE_CHANNEL, channelId);
  }

  // ─── Ad-hoc & Auto-extend ────────────────────────────────────

  async getAdHocEventsEnabled(): Promise<boolean> {
    return (await this.get(SETTING_KEYS.AD_HOC_EVENTS_ENABLED)) === 'true';
  }

  async setAdHocEventsEnabled(enabled: boolean): Promise<void> {
    await this.set(
      SETTING_KEYS.AD_HOC_EVENTS_ENABLED,
      enabled ? 'true' : 'false',
    );
  }

  async getEventAutoExtendEnabled(): Promise<boolean> {
    const v = await this.get(SETTING_KEYS.EVENT_AUTO_EXTEND_ENABLED);
    return v === null ? true : v === 'true';
  }

  async getEventAutoExtendIncrementMinutes(): Promise<number> {
    return getAutoExtendIncrement(this);
  }

  async getEventAutoExtendMaxOverageMinutes(): Promise<number> {
    return getAutoExtendMaxOverage(this);
  }

  async getEventAutoExtendMinVoiceMembers(): Promise<number> {
    return getAutoExtendMinVoice(this);
  }

  // ─── Steam ────────────────────────────────────────────────────

  async getSteamApiKey(): Promise<string | null> {
    return this.get(SETTING_KEYS.STEAM_API_KEY);
  }

  async setSteamApiKey(apiKey: string): Promise<void> {
    await this.set(SETTING_KEYS.STEAM_API_KEY, apiKey);
    this.eventEmitter.emit(SETTINGS_EVENTS.STEAM_UPDATED, { configured: true });
  }

  async isSteamConfigured(): Promise<boolean> {
    return this.exists(SETTING_KEYS.STEAM_API_KEY);
  }

  async clearSteamConfig(): Promise<void> {
    await this.delete(SETTING_KEYS.STEAM_API_KEY);
    this.eventEmitter.emit(SETTINGS_EVENTS.STEAM_UPDATED, null);
  }
}
