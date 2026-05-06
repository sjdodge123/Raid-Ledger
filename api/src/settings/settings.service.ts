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
import {
  getDiscordBotDefaultChannel as _getDiscordBotDefaultChannel,
  setDiscordBotDefaultChannel as _setDiscordBotDefaultChannel,
  isDiscordBotSetupCompleted as _isDiscordBotSetupCompleted,
  markDiscordBotSetupCompleted as _markDiscordBotSetupCompleted,
  getDiscordBotCommunityName as _getDiscordBotCommunityName,
  setDiscordBotCommunityName as _setDiscordBotCommunityName,
  getDiscordBotTimezone as _getDiscordBotTimezone,
  setDiscordBotTimezone as _setDiscordBotTimezone,
  getDefaultTimezone as _getDefaultTimezone,
  setDefaultTimezone as _setDefaultTimezone,
  getDiscordBotDefaultVoiceChannel as _getDiscordBotDefaultVoiceChannel,
  setDiscordBotDefaultVoiceChannel as _setDiscordBotDefaultVoiceChannel,
} from './settings-discord.helpers';

import { SETTINGS_EVENTS } from './settings.types';
import type {
  DiscordOAuthConfig,
  IgdbConfig,
  BlizzardConfig,
  BrandingConfig,
  DiscordBotConfig,
} from './settings.types';
import type { CommonGroundWeights } from '../lineups/common-ground-scoring.constants';
import { resolveCommonGroundWeights } from './common-ground-weights.helpers';

const CACHE_TTL_MS = 30 * 60_000;

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

  // STARTUP-CRITICAL: Settings cache must be available for all downstream services. @see bestEffortInit
  async onModuleInit(): Promise<void> {
    await this.loadCacheOrThrow();
  }

  /**
   * Ensures the settings cache is available and fresh.
   * Always awaits the reload when TTL has expired so callers never read
   * stale/empty data during the reload window.
   */
  private async ensureCache(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) return;
    if (!this.cacheLoadPromise) {
      this.cacheLoadPromise = this.loadCache();
    }
    await this.cacheLoadPromise;
  }

  /** Build a fresh decrypted-settings map from rows, swap into cache. */
  private async refreshCacheFromDb(): Promise<void> {
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
  }

  /** Loads all settings from DB, decrypts, and replaces the cache. */
  private async loadCache(): Promise<void> {
    try {
      await this.refreshCacheFromDb();
    } catch (err: unknown) {
      this.logger.error('Background cache refresh failed', err);
    } finally {
      this.cacheLoadPromise = null;
    }
  }

  /**
   * Startup-only variant that re-throws on failure.
   * Used by onModuleInit so a DB outage at boot crashes fast
   * rather than leaving an empty cache that causes cascading failures.
   */
  private loadCacheOrThrow(): Promise<void> {
    return this.refreshCacheFromDb();
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

  /** Force cache reload on next access. `full` also drops entries (ROK-1232). */
  invalidateCache(full = false): void {
    this.cacheLoadedAt = 0;
    if (!full) return;
    this.cache = new Map();
    this.cacheLoadPromise = null;
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

  setCommunityName = (name: string) =>
    this.set(SETTING_KEYS.COMMUNITY_NAME, name);
  setCommunityLogoPath = (filePath: string) =>
    this.set(SETTING_KEYS.COMMUNITY_LOGO_PATH, filePath);
  setCommunityAccentColor = (color: string) =>
    this.set(SETTING_KEYS.COMMUNITY_ACCENT_COLOR, color);
  clearBranding = () => _clearBranding(this);

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

  /** Get the default text channel ID for the Discord bot. */
  getDiscordBotDefaultChannel = () => _getDiscordBotDefaultChannel(this);
  /** Set the default text channel ID for the Discord bot. */
  setDiscordBotDefaultChannel = (id: string) =>
    _setDiscordBotDefaultChannel(this, id);
  /** Check if the Discord bot setup wizard has been completed. */
  isDiscordBotSetupCompleted = () => _isDiscordBotSetupCompleted(this);
  /** Mark the Discord bot setup wizard as completed. */
  markDiscordBotSetupCompleted = () => _markDiscordBotSetupCompleted(this);
  /** Get the Discord bot community name. */
  getDiscordBotCommunityName = () => _getDiscordBotCommunityName(this);
  /** Set the Discord bot community name. */
  setDiscordBotCommunityName = (n: string) =>
    _setDiscordBotCommunityName(this, n);
  /** Get the Discord bot timezone. */
  getDiscordBotTimezone = () => _getDiscordBotTimezone(this);
  /** Set the Discord bot timezone. */
  setDiscordBotTimezone = (tz: string) => _setDiscordBotTimezone(this, tz);
  /** Get the default timezone for events. */
  getDefaultTimezone = () => _getDefaultTimezone(this);
  /** Set the default timezone for events. */
  setDefaultTimezone = (tz: string) => _setDefaultTimezone(this, tz);
  /** Get the client URL with fallback chain. */
  getClientUrl = () => _getClientUrl(this);
  /** Get the default voice channel ID for the Discord bot. */
  getDiscordBotDefaultVoiceChannel = () =>
    _getDiscordBotDefaultVoiceChannel(this);
  /** Set the default voice channel ID for the Discord bot. */
  setDiscordBotDefaultVoiceChannel = (id: string) =>
    _setDiscordBotDefaultVoiceChannel(this, id);

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

  getSteamApiKey = () => this.get(SETTING_KEYS.STEAM_API_KEY);
  isSteamConfigured = () => this.exists(SETTING_KEYS.STEAM_API_KEY);

  async setSteamApiKey(apiKey: string): Promise<void> {
    await this.set(SETTING_KEYS.STEAM_API_KEY, apiKey);
    this.eventEmitter.emit(SETTINGS_EVENTS.STEAM_UPDATED, { configured: true });
  }

  async clearSteamConfig(): Promise<void> {
    await this.delete(SETTING_KEYS.STEAM_API_KEY);
    this.eventEmitter.emit(SETTINGS_EVENTS.STEAM_UPDATED, null);
  }

  // ─── ITAD ────────────────────────────────────────────────────

  getItadApiKey = () => this.get(SETTING_KEYS.ITAD_API_KEY);
  setItadApiKey = (key: string) => this.set(SETTING_KEYS.ITAD_API_KEY, key);
  isItadConfigured = () => this.exists(SETTING_KEYS.ITAD_API_KEY);
  clearItadConfig = () => this.delete(SETTING_KEYS.ITAD_API_KEY);

  // ─── Common Ground weights (ROK-950) ─────────────────────────

  async getCommonGroundWeights(): Promise<CommonGroundWeights> {
    return resolveCommonGroundWeights((key) => this.get(key));
  }
}
