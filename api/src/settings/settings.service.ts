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

export const SETTINGS_EVENTS = {
  OAUTH_DISCORD_UPDATED: 'settings.oauth.discord.updated',
  IGDB_UPDATED: 'settings.igdb.updated',
  BLIZZARD_UPDATED: 'settings.blizzard.updated',
  DEMO_MODE_UPDATED: 'settings.demo_mode.updated',
} as const;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Get a setting value by key (decrypted)
   */
  async get(key: SettingKey): Promise<string | null> {
    const result = await this.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    try {
      return decrypt(result[0].encryptedValue);
    } catch (error) {
      this.logger.error(`Failed to decrypt setting ${key}:`, error);
      return null;
    }
  }

  /**
   * Set a setting value (encrypted)
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

    this.logger.log(`Setting ${key} updated`);
  }

  /**
   * Delete a setting
   */
  async delete(key: SettingKey): Promise<void> {
    await this.db.delete(appSettings).where(eq(appSettings.key, key));
    this.logger.log(`Setting ${key} deleted`);
  }

  /**
   * Check if a setting exists
   */
  async exists(key: SettingKey): Promise<boolean> {
    const result = await this.db
      .select({ id: appSettings.id })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);

    return result.length > 0;
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
}
